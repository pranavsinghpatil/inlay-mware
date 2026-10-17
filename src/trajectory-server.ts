import { createServer, type IncomingMessage } from "node:http";
import { sendJson } from "./http.ts";
import { CodexTrajectoryReader } from "./trajectory-reader.ts";
import { TrajectoryStore } from "./trajectory-store.ts";
import { TRAJECTORY_HTML, TRAJECTORY_CSS, TRAJECTORY_JS } from "./trajectory-dashboard.ts";

function local(request: IncomingMessage): boolean {
  try {
    const host = new URL("http://" + request.headers.host);
    if (host.username || host.password || host.pathname !== "/" || host.search || host.hash) return false;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(host.hostname) || Number(host.port || 80) !== request.socket.localPort) return false;
    if (request.headers.origin !== undefined && request.headers.origin !== host.origin) return false;
    return request.headers["sec-fetch-site"] !== "cross-site";
  } catch { return false; }
}
export function createTrajectoryServer(store: TrajectoryStore, reader: CodexTrajectoryReader) {
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer"); response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
      if (!local(request)) { sendJson(response, 403, { error: "local_only" }); return; }
      if (request.method !== "GET") { sendJson(response, 405, { error: "read_only" }); return; }
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/health") { sendJson(response, 200, { status: store.status, source: "codex_local_records" }); return; }
      if (url.pathname === "/data") {
        await store.ready; const { sessions, ...storage } = store.snapshot();
        const models = [...new Set(sessions.flatMap(s => s.models))].sort();
        const filter = url.searchParams.get("outcome"); const model = url.searchParams.get("model");
        const matching = sessions.filter(s => !model || s.models.includes(model)).filter(s => filter === "failure" ? s.reportedFailure > 0 : filter === "success" ? s.reportedSuccess > 0 : filter === "gap" ? s.gaps > 0 : true).sort((a,b) => a.session.localeCompare(b.session));
        const after = Number(url.searchParams.get("after") ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) { sendJson(response, 400, { error: "invalid_cursor" }); return; }
        const totals = { events: 0, turns: 0, actions: 0, reportedSuccess: 0, reportedFailure: 0, gaps: 0 };
        for (const s of sessions) for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += s[key];
        sendJson(response, 200, { version: 1, storage, coverage: reader.snapshot(), models, totals, sessions: matching.slice(after, after + 100), next: matching.length > after + 100 ? after + 100 : null }); return;
      }
      if (url.pathname === "/events") {
        const after = Number(url.searchParams.get("after") ?? 0), session = url.searchParams.get("session") ?? "";
        if (!/^[a-f0-9]{32}$/.test(session) || !Number.isSafeInteger(after) || after < 0) { sendJson(response, 400, { error: "invalid_cursor" }); return; }
        sendJson(response, 200, await store.page(session, after, url.searchParams.get("tail") === "1")); return;
      }
      const asset = url.pathname === "/" ? ["text/html", TRAJECTORY_HTML] : url.pathname === "/style.css" ? ["text/css", TRAJECTORY_CSS] : url.pathname === "/app.js" ? ["text/javascript", TRAJECTORY_JS] : null;
      if (!asset) { sendJson(response, 404, { error: "not_found" }); return; }
      response.writeHead(200, { "Content-Type": asset[0] + "; charset=utf-8" }); response.end(asset[1]);
    })().catch(() => { if (!response.headersSent) sendJson(response, 503, { error: "trajectory_unavailable" }); else response.destroy(); });
  });
  let timer: ReturnType<typeof setInterval>;
  server.once("listening", () => { void reader.poll().catch(() => {}); timer = setInterval(() => { void reader.poll().catch(() => {}); }, 1000); timer.unref(); });
  server.once("close", () => { clearInterval(timer); void reader.close().then(() => store.close()).catch(() => {}); });
  return server;
}
