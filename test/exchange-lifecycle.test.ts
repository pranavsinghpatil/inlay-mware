import assert from "node:assert/strict";
import { createServer, get, request, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import { createInlayServer } from "../src/app.ts";
import { ExchangeLifecycle, type ExchangeLifecycleSnapshot } from "../src/exchange-lifecycle.ts";
import { MetricsStore, type RequestMetric } from "../src/metrics.ts";
import type { ProxyConfig } from "../src/config.ts";

// Synthetic bytes stay in memory. No captures, event records or research runners.
const BODY = Buffer.from(JSON.stringify({ input: [] }));
const FRAME = Buffer.from('event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":1,"total_tokens":4}}}\n\n');
const options = { timeout: 10_000 };

function gate<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function close(server: Server) {
  if (!server.listening) return;
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections();
  await closed;
}

function client(port: number, holdBody = false, path = "/v1/responses") {
  const ended = gate(), frameReceived = gate();
  let bytes = Buffer.alloc(0), status: number | null = null;
  const outgoing = request({ host: "127.0.0.1", port, path, method: "POST",
    headers: { "content-type": "application/json" } }, (response) => {
    status = response.statusCode ?? null;
    response.on("data", (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length >= FRAME.length) frameReceived.resolve();
    });
    response.on("end", () => ended.resolve());
    response.on("close", () => ended.resolve());
    response.on("error", () => ended.resolve());
  });
  outgoing.on("error", () => ended.resolve());
  outgoing.flushHeaders();
  if (!holdBody) outgoing.end(BODY);
  return { outgoing, ended: ended.promise, frameReceived: frameReceived.promise,
    release: () => outgoing.end(BODY), destroy: () => outgoing.destroy(),
    bytes: () => bytes, status: () => status };
}

interface MetricsResponse {
  totalRequests: number;
  totalRequestBytes: number;
  recent: RequestMetric[];
  retention: string;
  exchangeLifecycle: ExchangeLifecycleSnapshot;
}

function jsonGet(port: number, path = "/metrics"): Promise<{ status: number; value: MetricsResponse }> {
  return new Promise((resolve, reject) => {
    get({ host: "127.0.0.1", port, path }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => {
        try { resolve({ status: response.statusCode!, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
        catch (error) { reject(error); }
      });
    }).on("error", reject);
  });
}

function counts(snapshot: MetricsResponse, expected: [number, number, number, number]) {
  const state = snapshot.exchangeLifecycle;
  assert.deepEqual([state.admitted, state.active, state.forwarding, state.finalized], expected);
  assert.equal(state.availability, "AVAILABLE");
  assert.equal(state.incomplete, false);
  assert.equal(state.unavailableReason, null);
  assert.equal(state.admitted, state.active! + state.finalized!);
  assert.deepEqual(Object.keys(state).sort(), [
    "admitted", "active", "forwarding", "finalized", "availability", "incomplete", "unavailableReason",
  ].sort());
}

async function harness(t: TestContext, upstreamHandler: (response: ServerResponse, body: Buffer) => void,
  config: Partial<ProxyConfig> = {}, configured = true) {
  const upstream = createServer(async (incoming, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    upstreamHandler(response, Buffer.concat(chunks));
  });
  const upstreamPort = await listen(upstream);
  const metrics = new MetricsStore();
  const proxy = createInlayServer({
    host: "127.0.0.1", port: 0, maxBodyBytes: 1024, upstreamTimeoutMs: 10_000,
    observationMode: "structural", timelineMode: "off",
    ...(configured ? { upstreamBaseUrl: new URL("http://127.0.0.1:" + upstreamPort + "/v1") } : {}),
    ...config,
  }, metrics);
  const port = await listen(proxy);
  const clients: ReturnType<typeof client>[] = [];
  t.after(async () => {
    for (const c of clients) c.destroy();
    await Promise.all([close(proxy), close(upstream)]);
  });
  const read = async () => (await jsonGet(port)).value;
  const settled = async (finalized: number) => {
    const deadline = performance.now() + 5_000;
    while (performance.now() < deadline) {
      const snapshot = await read();
      assert.equal(snapshot.exchangeLifecycle.availability, "AVAILABLE");
      if (snapshot.exchangeLifecycle.finalized === finalized) return snapshot;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error("Callback settlement watchdog expired.");
  };
  return { proxy, metrics, port, read, settled,
    start: (held = false, path?: string) => { const c = client(port, held, path); clients.push(c); return c; } };
}

function legacyUnchanged(snapshot: MetricsResponse, metrics: MetricsStore) {
  const { exchangeLifecycle: _state, ...legacy } = snapshot;
  assert.deepEqual(legacy, JSON.parse(JSON.stringify(metrics.snapshot())));
}

function successfulOutcome(snapshot: MetricsResponse, expectedRequests = 1) {
  assert.equal(snapshot.totalRequests, expectedRequests);
  assert.equal(snapshot.totalRequestBytes, BODY.length * expectedRequests);
  const row = snapshot.recent[0];
  assert.equal(row.responseStatus, 200);
  assert.equal(row.errorCategory, undefined);
  assert.equal(row.completed, true);
  assert.equal(row.cancelled, false);
  assert.equal(row.terminalEventObserved, true);
  assert.equal(row.responseObservationIncomplete, false);
  assert.equal(row.responseBytes, FRAME.length);
  assert.deepEqual(row.usage, { inputTokens: 3, outputTokens: 1, totalTokens: 4 });
  assert.ok(row.durationMs >= 0);
  assert.ok(row.timeToUpstreamHeadersMs !== undefined);
  assert.ok(row.timeToFirstResponseBodyByteMs !== undefined);
}

test("normal exchange distinguishes admission, forwarding and finalization without changing outcome metrics", options, async (t) => {
  const receipt = gate<ServerResponse>();
  const h = await harness(t, (response, body) => { assert.deepEqual(body, BODY); receipt.resolve(response); });
  counts(await h.read(), [0, 0, 0, 0]);
  const admitted = once(h.proxy, "request");
  const c = h.start(true);
  await admitted;
  const bodyHeld = await h.read();
  counts(bodyHeld, [1, 1, 0, 0]); assert.equal(bodyHeld.totalRequests, 0);
  legacyUnchanged(bodyHeld, h.metrics);
  c.release();
  const response = await receipt.promise;
  const headersHeld = await h.read();
  counts(headersHeld, [1, 1, 1, 0]); assert.equal(headersHeld.totalRequests, 0);
  response.writeHead(200, { "content-type": "text/event-stream" }); response.end(FRAME);
  await c.ended;
  const done = await h.settled(1);
  counts(done, [1, 0, 1, 1]); successfulOutcome(done); legacyUnchanged(done, h.metrics);
  assert.equal(c.status(), 200); assert.deepEqual(c.bytes(), FRAME);
});

test("upstream failure counts an actual forwarding invocation and a handled finalization", options, async (t) => {
  let received = 0;
  const h = await harness(t, (response, body) => { received++; assert.deepEqual(body, BODY); response.destroy(); });
  const c = h.start(); await c.ended;
  const done = await h.settled(1);
  counts(done, [1, 0, 1, 1]); assert.equal(received, 1);
  assert.equal(done.totalRequests, 1); assert.equal(done.totalRequestBytes, BODY.length);
  assert.equal(done.recent[0].errorCategory, "upstream_unavailable");
  assert.equal(done.recent[0].completed, false); assert.equal(done.recent[0].cancelled, false);
  assert.equal(done.recent[0].responseStatus, undefined); assert.equal(done.recent[0].usage, undefined);
  assert.equal(c.status(), 502); assert.equal(JSON.parse(c.bytes().toString()).error.code, "inlay_upstream_unavailable");
  legacyUnchanged(done, h.metrics);
});

test("pre-forward body rejection finalizes without invoking forwarding or changing invalid-request metrics", options, async (t) => {
  let received = 0;
  const h = await harness(t, () => { received++; }, { maxBodyBytes: 1 });
  const c = h.start(); await c.ended;
  const done = await h.settled(1);
  counts(done, [1, 0, 0, 1]); assert.equal(received, 0);
  assert.equal(done.totalRequests, 1); assert.equal(done.totalRequestBytes, 0);
  assert.equal(done.recent[0].errorCategory, "invalid_request");
  assert.equal(done.recent[0].requestBytes, 0);
  assert.equal(done.recent[0].completed, undefined);
  legacyUnchanged(done, h.metrics);
  // readBody destroys the oversized request; this test makes no delivery claim.
});

test("missing upstream configuration finalizes while the existing outcome store stays empty", options, async (t) => {
  let received = 0;
  const h = await harness(t, () => { received++; }, {}, false);
  const c = h.start(); await c.ended;
  const done = await h.settled(1);
  counts(done, [1, 0, 0, 1]); assert.equal(received, 0);
  assert.equal(done.totalRequests, 0); assert.deepEqual(done.recent, []);
  assert.equal(c.status(), 503); assert.equal(JSON.parse(c.bytes().toString()).error.code, "inlay_upstream_not_configured");
  legacyUnchanged(done, h.metrics);
});

test("a held stream remains active after a terminal SSE frame and finalizes only after callback settlement", options, async (t) => {
  const receipt = gate<ServerResponse>();
  const h = await harness(t, (response) => {
    response.writeHead(200, { "content-type": "text/event-stream" }); response.write(FRAME); receipt.resolve(response);
  });
  const c = h.start(); const response = await receipt.promise; await c.frameReceived;
  const open = await h.read();
  counts(open, [1, 1, 1, 0]); assert.equal(open.totalRequests, 0); legacyUnchanged(open, h.metrics);
  response.end(); await c.ended;
  const done = await h.settled(1);
  counts(done, [1, 0, 1, 1]); successfulOutcome(done); legacyUnchanged(done, h.metrics);
  assert.deepEqual(c.bytes(), FRAME);
});

test("controlled disconnect after response activity finalizes independently of delivery and cancellation semantics", options, async (t) => {
  const h = await harness(t, (response) => {
    response.writeHead(200, { "content-type": "text/event-stream" }); response.write(FRAME);
  });
  const c = h.start(); await c.frameReceived;
  counts(await h.read(), [1, 1, 1, 0]); c.destroy(); await c.ended;
  const done = await h.settled(1);
  counts(done, [1, 0, 1, 1]);
  assert.equal(done.totalRequests, 1); assert.equal(done.totalRequestBytes, BODY.length);
  assert.equal(done.recent[0].errorCategory, "client_disconnect");
  assert.equal(done.recent[0].completed, false); assert.equal(done.recent[0].cancelled, true);
  assert.equal(done.recent[0].terminalEventObserved, true); assert.equal(done.recent[0].cancelledAfterTerminalEvent, true);
  assert.equal(done.recent[0].responseObservationIncomplete, false);
  assert.ok(FRAME.subarray(0, c.bytes().length).equals(c.bytes())); // Observed prefix only.
  legacyUnchanged(done, h.metrics);
});

test("concurrent streams retain aggregate counts when the second handler completes before the first", options, async (t) => {
  const firstReceipt = gate<ServerResponse>(), secondReceipt = gate<ServerResponse>();
  let received = 0;
  const h = await harness(t, (response, body) => {
    assert.deepEqual(body, BODY); received++;
    response.writeHead(200, { "content-type": "text/event-stream" }); response.write(FRAME);
    (received === 1 ? firstReceipt : secondReceipt).resolve(response);
  });
  const first = h.start(); const firstResponse = await firstReceipt.promise; await first.frameReceived;
  const second = h.start(); const secondResponse = await secondReceipt.promise; await second.frameReceived;
  const both = await h.read(); counts(both, [2, 2, 2, 0]); assert.equal(both.totalRequests, 0); legacyUnchanged(both, h.metrics);
  secondResponse.end(); await second.ended;
  const one = await h.settled(1);
  counts(one, [2, 1, 2, 1]); successfulOutcome(one); assert.equal(one.recent[0].observationSequence, 2);
  legacyUnchanged(one, h.metrics);
  firstResponse.end(); await first.ended;
  const done = await h.settled(2);
  counts(done, [2, 0, 2, 2]); successfulOutcome(done, 2);
  assert.deepEqual(done.recent.map((row) => row.observationSequence), [1, 2]);
  assert.deepEqual(first.bytes(), FRAME); assert.deepEqual(second.bytes(), FRAME);
  legacyUnchanged(done, h.metrics);
});

test("health, metrics and unsupported routes are excluded; all exact supported paths are admitted", options, async (t) => {
  const h = await harness(t, () => assert.fail("Unconfigured server must not forward."), {}, false);
  assert.equal((await jsonGet(h.port, "/health")).status, 200);
  assert.equal((await jsonGet(h.port, "/missing")).status, 404);
  assert.equal((await jsonGet(h.port, "/v1/responses")).status, 404);
  const unsupported = h.start(false, "/v1/responses?x=1"); await unsupported.ended;
  assert.equal(unsupported.status(), 404); counts(await h.read(), [0, 0, 0, 0]);
  let admitted = 0;
  for (const path of ["/v1/responses", "/v1/codex/responses", "/v1/chat/completions"]) {
    const c = h.start(false, path); await c.ended; admitted++;
    const done = await h.settled(admitted);
    counts(done, [admitted, 0, 0, admitted]); assert.equal(c.status(), 503); legacyUnchanged(done, h.metrics);
  }
});

test("each server instance starts a separate local accounting lifetime", options, async (t) => {
  const first = await harness(t, () => {}, {}, false);
  const c = first.start(); await c.ended; counts(await first.settled(1), [1, 0, 0, 1]);
  const second = await harness(t, () => {}, {}, false);
  counts(await second.read(), [0, 0, 0, 0]); assert.equal((await second.read()).totalRequests, 0);
});

test("numeric exhaustion and invalid transitions expose unavailable null scalars, never fabricated zero", () => {
  const overflow = new ExchangeLifecycle();
  // Seed only a scalar numeric boundary, without billions of synthetic requests.
  Reflect.set(overflow, "admitted", Number.MAX_SAFE_INTEGER);
  Reflect.set(overflow, "finalized", Number.MAX_SAFE_INTEGER);
  overflow.admit();
  assert.equal(overflow.snapshot().unavailableReason, "overflow");
  const invalid = new ExchangeLifecycle(); invalid.finalize();
  assert.equal(invalid.snapshot().unavailableReason, "invalid_transition");
  const noActive = new ExchangeLifecycle(); noActive.forward();
  const duplicateForward = new ExchangeLifecycle(); duplicateForward.admit(); duplicateForward.forward(); duplicateForward.forward();
  for (const state of [overflow, invalid, noActive, duplicateForward]) {
    state.admit(); state.forward(); state.finalize(); // Unavailability is sticky.
    const snapshot = state.snapshot();
    assert.deepEqual([snapshot.admitted, snapshot.active, snapshot.forwarding, snapshot.finalized], [null, null, null, null]);
    assert.equal(snapshot.availability, "UNAVAILABLE"); assert.equal(snapshot.incomplete, true);
  }
});
