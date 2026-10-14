import assert from "node:assert/strict";
import { createServer, get, type Server } from "node:http";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createInlayServer } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { MetricsStore, type RequestMetric } from "../src/metrics.ts";
import type { SessionSummary } from "../src/local-history.ts";
import { isObservationTotals } from "../src/local-observation.ts";

async function listen(server: Server, t: TestContext): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => close(server));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections();
  await closed;
}
async function json(base: string, path: string) {
  const response = await fetch(base + path);
  return { status: response.status, data: await response.json() };
}
async function waitFor<T>(check: () => Promise<T | undefined>): Promise<T> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Local checkpoint did not settle within test deadline.");
}
async function fixture(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "inlay-dashboard-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  return directory;
}
function metric(index = 0): RequestMetric {
  return { requestId: `synthetic-id-${index}`, startedAt: "2026-10-13T00:00:00.000Z", route: "/v1/responses", durationMs: 2,
    requestBytes: 4, responseBytes: 7, usage: { inputTokens: 3, outputTokens: 1, cachedInputTokens: 0 },
    completed: true, cancelled: false, terminalEventObserved: true, responseObservationIncomplete: false };
}

test("dashboard aliases and assets work locally without changing health or metrics APIs", async (t) => {
  const base = await listen(createInlayServer(loadConfig({})), t);
  const before = await json(base, "/metrics");
  assert.equal(before.status, 200);
  for (const path of ["/", "/dashboard", "/dashboard/"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /text\/html/);
    assert.match(await response.text(), /Local observation/);
    assert.match(response.headers.get("content-security-policy")!, /connect-src 'self'/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  for (const path of ["/dashboard/app.js", "/dashboard/style.css", "/dashboard/export.js"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).length > 100);
  }
  const logo = await fetch(base + "/dashboard/logo.png");
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await logo.arrayBuffer()), await readFile(new URL("../assets/inlay-mark.png", import.meta.url)));
  assert.match(logo.headers.get("content-security-policy")!, /img-src 'self'/);
  const deniedLogo = await fetch(base + "/dashboard/logo.png", { headers: { Origin: "https://example.com" } });
  assert.equal(deniedLogo.status, 403);
  assert.deepEqual((await json(base, "/health")).data, { status: "ok", upstreamConfigured: false, mode: "transparent" });
  assert.deepEqual((await json(base, "/metrics")).data, before.data);
  assert.equal((await fetch(base + "/dashboard", { method: "POST" })).status, 404);
});

test("empty and disabled observation states remain explicit rather than assumed zero usage", async (t) => {
  const base = await listen(createInlayServer(loadConfig({})), t);
  const { data } = await json(base, "/dashboard/data");
  assert.equal(data.current.totals.outcomes, 0);
  assert.equal(data.current.totals.usage.inputTokens.sum, null);
  assert.equal(data.current.totals.usage.inputTokens.available, 0);
  assert.equal(data.current.recurrence, null);
  assert.equal(data.modes.observation, "off");
  assert.equal(data.history.status, "off");
  assert.deepEqual(data.recent, []);
});

test("new recordings refresh full-session aggregates beyond the bounded recent window", async (t) => {
  const store = new MetricsStore();
  const base = await listen(createInlayServer(loadConfig({}), store), t);
  assert.equal((await json(base, "/dashboard/data")).data.current.totals.outcomes, 0);
  for (let index = 0; index < 125; index += 1) store.record(metric(index));
  const { data } = await json(base, "/dashboard/data");
  assert.equal(data.current.totals.outcomes, 125);
  assert.equal(data.current.totals.usage.inputTokens.sum, 375);
  assert.deepEqual(data.current.totals.usage.cachedInputTokens, { sum: 0, available: 125, missing: 0 });
  assert.equal(data.recent.length, 20);
  assert.equal((await json(base, "/metrics")).data.recent.length, 100);
  assert.equal(JSON.stringify(data).includes("synthetic-id-"), false);
});

test("dashboard rejects foreign browser origins and rebinding hosts; existing metrics stay unchanged", async (t) => {
  const base = await listen(createInlayServer(loadConfig({})), t);
  for (const headers of [{ origin: "https://foreign.invalid" }, { host: "foreign.invalid" }, { "sec-fetch-site": "cross-site" }]) {
    // Native HTTP preserves the hostile Host header; fetch replaces it with the URL host.
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      get(base + "/dashboard/data", { headers }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString() }));
      }).on("error", reject);
    });
    assert.equal(result.status, 403, JSON.stringify(headers));
    assert.equal(result.body.includes("foreign.invalid"), false);
  }
  assert.equal((await fetch(base + "/metrics", { headers: { origin: "https://foreign.invalid" } })).status, 200);
});

test("proxy bytes and APIs stay intact while only aggregate session evidence persists and reloads", async (t) => {
  const directory = await fixture(t);
  const sentinel = "SYNTHETIC_PRIVATE_SENTINEL_42";
  const body = JSON.stringify({ input: [{ type: "message", content: sentinel }], metadata: { privatePath: sentinel } });
  const frame = `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 3, output_tokens: 1, input_tokens_details: { cached_tokens: 0 } }, ignored: sentinel } })}\n\n`;
  const upstream = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(chunks).toString(), body);
    assert.equal(request.headers.authorization, `Bearer ${sentinel}`);
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(frame);
  });
  const upstreamBase = await listen(upstream, t);
  const config = { ...loadConfig({ INLAY_OBSERVATION: "structural", INLAY_RECURRENCE_PROBE: "exact-item" }),
    upstreamBaseUrl: new URL(upstreamBase + "/v1"), historyDirectory: directory, historyMaxSessions: 2 };
  const server = createInlayServer(config);
  const base = await listen(server, t);
  const forwarded = await fetch(base + "/v1/responses", { method: "POST", body, headers: { authorization: `Bearer ${sentinel}`, "content-type": "application/json" } });
  assert.equal(await forwarded.text(), frame);
  const metrics = (await json(base, "/metrics")).data;
  const dashboard = (await json(base, "/dashboard/data")).data;
  assert.equal(metrics.totalRequests, 1);
  assert.equal(metrics.recent[0].usage.inputTokens, 3);
  assert.equal(dashboard.history.status, "ready", dashboard.history.reason);
  assert.equal(isObservationTotals(dashboard.current.totals), true, "Runtime aggregate must meet persisted contract");
  assert.equal(dashboard.current.totals.outcomes, 1);
  assert.equal(dashboard.current.totals.usage.inputTokens.sum, 3);
  assert.equal(dashboard.current.totals.structure.available, 1);
  assert.equal(dashboard.current.totals.recurrence.available, 1);
  assert.equal(JSON.stringify(dashboard).includes(sentinel), false);
  assert.equal(JSON.stringify(dashboard).includes(metrics.recent[0].requestId), false);
  assert.equal(dashboard.current.sessionId === metrics.recent[0].requestId, false);
  await close(server);
  const path = join(directory, "inlay-history.json");
  // Server close starts an asynchronous final checkpoint. Wait for its lock release
  // before inspecting bytes, rather than opening the destination during atomic rename.
  await waitFor(async () => {
    try { await access(join(directory, "inlay-history.lock")); return undefined; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
  });
  const persisted = JSON.parse(await readFile(path, "utf8")) as { sessions: SessionSummary[] };
  assert.equal(persisted.sessions[0].state, "closed");
  assert.equal(persisted.sessions[0].totals.usage.inputTokens.sum, 3);
  assert.equal(persisted.sessions[0].endedAt === null, false);
  const encoded = JSON.stringify(persisted);
  for (const prohibited of [sentinel, metrics.recent[0].requestId, directory, "requestId", "recent", "authorization", "timeline", "durationMs", "route"]) {
    assert.equal(encoded.includes(prohibited), false, prohibited);
  }
  const next = createInlayServer(config);
  const nextBase = await listen(next, t);
  const reloaded = (await json(nextBase, "/dashboard/data")).data;
  assert.equal(reloaded.current.totals.outcomes, 0);
  assert.ok(reloaded.history.sessions.some((session: SessionSummary) => session.sessionId === persisted.sessions[0].sessionId && session.state === "closed"));
  await close(next);
  await waitFor(async () => {
    try { await access(join(directory, "inlay-history.lock")); return undefined; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return true; throw error; }
  });
});

test("unavailable history does not affect proxy handling or invent a saved session", async (t) => {
  const directory = await fixture(t);
  const server = createInlayServer({ ...loadConfig({}), historyDirectory: join(directory, "bad") });
  // Force a filesystem setup error without changing the proxy configuration.
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(directory, "bad"), "synthetic blocker");
  const base = await listen(server, t);
  const { data } = await json(base, "/dashboard/data");
  assert.equal(data.history.status, "unavailable");
  assert.equal(data.history.reason, "io_error");
  assert.deepEqual(data.history.sessions, []);
  assert.equal((await fetch(base + "/v1/responses", { method: "POST", body: "{}" })).status, 503);
  assert.equal((await json(base, "/metrics")).data.exchangeLifecycle.finalized, 1);
});

test("record subscribers fail open and detach when a server closes", async (t) => {
  const store = new MetricsStore();
  store.subscribeRecords(() => { throw new Error("synthetic subscriber failure"); });
  const server = createInlayServer(loadConfig({}), store);
  const base = await listen(server, t);
  store.record(metric());
  assert.equal((await json(base, "/metrics")).data.totalRequests, 1);
  assert.equal((await json(base, "/dashboard/data")).data.current.totals.outcomes, 1);
  await close(server);
  assert.doesNotThrow(() => store.record(metric()));
  assert.equal((store.snapshot() as { totalRequests: number }).totalRequests, 2);
});

test("an unexpected aggregate failure becomes unavailable while recorded metrics and forwarding remain usable", async (t) => {
  const store = new MetricsStore();
  const base = await listen(createInlayServer(loadConfig({}), store), t);
  const large = { ...metric(), requestStructure: { canonicalStructuralBytesTotal: 0, topLevelFieldCount: 0, topLevelFields: [], inputItemTypeCounts: { message: Number.MAX_SAFE_INTEGER } } };
  store.record(large);
  store.record(large);
  const view = await json(base, "/dashboard/data");
  assert.equal(view.status, 503);
  assert.equal(view.data.error.code, "inlay_dashboard_aggregation_unavailable");
  assert.equal((await json(base, "/metrics")).data.totalRequests, 2);
  assert.equal((await fetch(base + "/v1/responses", { method: "POST", body: "{}" })).status, 503);
});
