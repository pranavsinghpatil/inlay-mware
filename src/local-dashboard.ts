import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { ProxyConfig } from "./config.ts";
import type { MetricsStore, RequestMetric } from "./metrics.ts";
import type { ExchangeLifecycle } from "./exchange-lifecycle.ts";
import type { ExactItemRecurrenceTracker } from "./observation.ts";
import { sendJson } from "./http.ts";
import { ObservationAccumulator, projectRecent, projectRecurrence } from "./local-observation.ts";
import { LocalHistory, type SessionSummary } from "./local-history.ts";
import { DASHBOARD_HTML, DASHBOARD_CSS, DASHBOARD_JS } from "./dashboard.ts";
import { DASHBOARD_EXPORT_JS } from "./dashboard-export.ts";

const DASHBOARD_LOGO = readFileSync(new URL("../assets/inlay-mark.png", import.meta.url));

const REFRESH_MS = 2_000;
const CHECKPOINT_MS = 5_000;
const paths = new Set(["/trajectories", "/", "/dashboard", "/dashboard/", "/dashboard/data", "/dashboard/style.css", "/dashboard/app.js", "/dashboard/logo.png", "/dashboard/export.js"]);

export function isDashboardRequest(request: IncomingMessage): boolean {
  return request.method === "GET" && paths.has(request.url ?? "");
}

function localBrowserRequest(request: IncomingMessage): boolean {
  try {
    if (!request.headers.host) return false;
    const url = new URL(`http://${request.headers.host}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return false;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
    if (Number(url.port || 80) !== request.socket.localPort) return false;
    if (request.headers.origin !== undefined && request.headers.origin !== url.origin) return false;
    return request.headers["sec-fetch-site"] !== "cross-site";
  } catch { return false; }
}

/** Presentation over existing records; persistence is separate from forwarding. */
export class LocalDashboard {
  #accumulator = new ObservationAccumulator();
  #history: LocalHistory;
  #startedAt = new Date().toISOString();
  #sessionId = randomUUID();
  #endedAt: string | null = null;
  #available = true;
  #unsubscribe: () => void;
  #timer: ReturnType<typeof setInterval> | undefined;
  #config: ProxyConfig;
  #metrics: MetricsStore;
  #lifecycle: ExchangeLifecycle;
  #recurrence: ExactItemRecurrenceTracker | undefined;

  constructor(config: ProxyConfig, metrics: MetricsStore, lifecycle: ExchangeLifecycle, recurrence?: ExactItemRecurrenceTracker) {
    this.#config = config;
    this.#metrics = metrics;
    this.#lifecycle = lifecycle;
    this.#recurrence = recurrence;
    this.#history = new LocalHistory(undefined, config.historyMaxSessions ?? 20);
    this.#unsubscribe = metrics.subscribeRecords((metric) => {
      if (!this.#available) return;
      try { this.#accumulator.record(metric); } catch { this.#available = false; }
    });
  }

  attach(server: Server): void {
    server.once("listening", () => {
      this.#history = new LocalHistory(this.#config.historyDirectory, this.#config.historyMaxSessions ?? 20);
      this.#checkpoint();
      this.#timer = setInterval(() => this.#checkpoint(), CHECKPOINT_MS);
      this.#timer.unref();
    });
    server.once("close", () => {
      if (this.#timer) clearInterval(this.#timer);
      this.#unsubscribe();
      this.#endedAt = new Date().toISOString();
      void this.#history.close(this.#available ? this.#summary() : undefined).catch(() => {});
    });
  }

  #summary(): SessionSummary {
    return {
      sessionId: this.#sessionId, startedAt: this.#startedAt,
      updatedAt: new Date().toISOString(), endedAt: this.#endedAt,
      state: this.#endedAt === null ? "running" : "closed",
      totals: this.#accumulator.snapshot(), lifecycle: this.#lifecycle.snapshot(),
      recurrence: projectRecurrence(this.#recurrence?.snapshot()),
    };
  }

  #checkpoint(): void {
    if (this.#available) void this.#history.save(this.#summary()).catch(() => {});
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (!isDashboardRequest(request)) return false;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    if (!localBrowserRequest(request)) {
      sendJson(response, 403, { error: { code: "inlay_dashboard_local_only" } });
      return true;
    }
    if (request.url === "/trajectories") {
      response.writeHead(302, { Location: "http://127.0.0.1:8788/" });
      response.end();
      return true;
    }
    if (request.url === "/dashboard/data") {
      await this.#history.ready;
      if (!this.#available) {
        sendJson(response, 503, { error: { code: "inlay_dashboard_aggregation_unavailable" } });
        return true;
      }
      const snapshot = this.#metrics.snapshot() as { recent: RequestMetric[] };
      const history = this.#history.snapshot();
      sendJson(response, 200, {
        version: 1,
        modes: { observation: this.#config.observationMode, recurrence: this.#config.recurrenceProbe ?? "off" },
        current: this.#summary(), recent: snapshot.recent.slice(0, 20).map(projectRecent),
        history: { ...history, sessions: history.sessions.reverse() }, refreshMs: REFRESH_MS, checkpointMs: CHECKPOINT_MS,
      });
      return true;
    }
    if (request.url === "/dashboard/logo.png") {
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(DASHBOARD_LOGO);
      return true;
    }
    const [type, body] = request.url === "/dashboard/export.js" ? ["text/javascript", DASHBOARD_EXPORT_JS]
      : request.url === "/dashboard/style.css" ? ["text/css", DASHBOARD_CSS]
      : request.url === "/dashboard/app.js" ? ["text/javascript", DASHBOARD_JS]
      : ["text/html", DASHBOARD_HTML];
    response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
    response.end(body);
    return true;
  }
}
