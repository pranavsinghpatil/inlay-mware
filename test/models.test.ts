import assert from "node:assert/strict";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { createInlayServer } from "../src/app.ts";
import { MetricsStore } from "../src/metrics.ts";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections();
  await closed;
}

function get(port: number, path = "/v1/models", headers: Record<string, string> = {}) {
  return new Promise<{ status: number; statusMessage?: string; headers: IncomingMessage["headers"]; body: Buffer }>((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, path, method: "GET", headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode ?? 0, statusMessage: response.statusMessage, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for synthetic upstream event.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("GET /v1/models forwards query and client headers while preserving compressed response bytes", async () => {
  const compressed = gzipSync(Buffer.from("synthetic model catalog"));
  const upstream = createServer((incoming, response) => {
    assert.equal(incoming.method, "GET");
    assert.equal(incoming.url, "/backend-api/codex/models?limit=2&host=attacker.example&tag=a%2Fb");
    assert.equal(incoming.headers.host, `127.0.0.1:${upstreamPort}`);
    assert.equal(incoming.headers.authorization, "Bearer synthetic-token");
    assert.equal(incoming.headers["x-client-trace"], "trace-42");
    assert.equal(incoming.headers["x-hop-request"], undefined);
    response.writeHead(206, "Catalog Partial", {
      "content-type": "application/json",
      "content-encoding": "gzip",
      "content-length": String(compressed.length),
      connection: "x-hop-response",
      "x-hop-response": "remove-me",
      "x-upstream-trace": "upstream-7",
    });
    response.end(compressed);
  });
  const upstreamPort = await listen(upstream);
  const metrics = new MetricsStore();
  const proxy = createInlayServer({
    host: "127.0.0.1", port: 0,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}/backend-api/codex`),
    maxBodyBytes: 1024, upstreamTimeoutMs: 1_000, observationMode: "structural",
  }, metrics);
  const proxyPort = await listen(proxy);

  try {
    const response = await get(proxyPort, "/v1/models?limit=2&host=attacker.example&tag=a%2Fb", {
      authorization: "Bearer synthetic-token",
      "x-client-trace": "trace-42",
      connection: "x-hop-request, keep-alive",
      "x-hop-request": "remove-me",
    });
    assert.equal(response.status, 206);
    assert.equal(response.statusMessage, "Catalog Partial");
    assert.equal(response.headers["content-encoding"], "gzip");
    assert.equal(response.headers["content-length"], String(compressed.length));
    assert.equal(response.headers["x-upstream-trace"], "upstream-7");
    assert.equal(response.headers["x-hop-response"], undefined);
    assert.deepEqual(response.body, compressed);
    const outcomeSnapshot = metrics.snapshot() as { totalRequests: number; totalRequestBytes: number; recent: unknown[] };
    assert.equal(outcomeSnapshot.totalRequests, 0);
    assert.equal(outcomeSnapshot.totalRequestBytes, 0);
    assert.deepEqual(outcomeSnapshot.recent, []);
    const lifecycle = await get(proxyPort, "/metrics");
    const snapshot = JSON.parse(lifecycle.body.toString("utf8"));
    assert.deepEqual(snapshot.exchangeLifecycle, {
      admitted: 0, active: 0, forwarding: 0, finalized: 0,
      availability: "AVAILABLE", incomplete: false, unavailableReason: null,
    });
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("GET /v1/models dispatch requires the literal route and does not normalize aliases", async () => {
  const proxy = createInlayServer({ host: "127.0.0.1", port: 0, maxBodyBytes: 1024, upstreamTimeoutMs: 100, observationMode: "off" });
  const port = await listen(proxy);
  try {
    for (const path of ["/v1/models/", "/v1/other/../models"]) {
      assert.equal((await get(port, path)).status, 404, `${path} should not alias /v1/models`);
    }
    const post = await new Promise<number>((resolve, reject) => {
      const outgoing = request({ host: "127.0.0.1", port, path: "/v1/models", method: "POST" }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      });
      outgoing.on("error", reject);
      outgoing.end();
    });
    assert.equal(post, 404);
  } finally {
    await close(proxy);
  }
});

test("GET /v1/models rejects a declared request body before forwarding", async () => {
  let upstreamRequests = 0;
  const upstream = createServer(() => { upstreamRequests += 1; });
  const upstreamPort = await listen(upstream);
  const proxy = createInlayServer({
    host: "127.0.0.1", port: 0,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}/v1`),
    maxBodyBytes: 1024, upstreamTimeoutMs: 1_000, observationMode: "off",
  });
  const proxyPort = await listen(proxy);
  try {
    const result = await new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
      const outgoing = request({ host: "127.0.0.1", port: proxyPort, path: "/v1/models", method: "GET", headers: { "content-length": "3" } }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on("error", reject);
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }));
      });
      outgoing.on("error", reject);
      outgoing.end("bad");
    });
    assert.equal(result.status, 400);
    assert.deepEqual(JSON.parse(result.body.toString("utf8")), {
      error: { code: "inlay_invalid_request", message: "GET /v1/models does not accept a request body." },
    });
    assert.equal(upstreamRequests, 0);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("GET /v1/models reports a fixed missing-upstream error without accounting", async () => {
  const metrics = new MetricsStore();
  const proxy = createInlayServer({ host: "127.0.0.1", port: 0, maxBodyBytes: 1024, upstreamTimeoutMs: 100, observationMode: "off" }, metrics);
  const port = await listen(proxy);
  try {
    const response = await get(port);
    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(response.body.toString("utf8")), {
      error: { code: "inlay_upstream_not_configured", message: "Set INLAY_UPSTREAM_BASE_URL to enable forwarding." },
    });
    assert.equal((metrics.snapshot() as { totalRequests: number }).totalRequests, 0);
  } finally {
    await close(proxy);
  }
});

test("GET /v1/models timeout returns a fixed error and stays outside lifecycle accounting", async () => {
  const upstream = createServer(() => {});
  const upstreamPort = await listen(upstream);
  const metrics = new MetricsStore();
  const proxy = createInlayServer({
    host: "127.0.0.1", port: 0,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}/v1`),
    maxBodyBytes: 1024, upstreamTimeoutMs: 30, observationMode: "off",
  }, metrics);
  const proxyPort = await listen(proxy);
  try {
    const response = await get(proxyPort);
    assert.equal(response.status, 504);
    assert.deepEqual(JSON.parse(response.body.toString("utf8")), {
      error: { code: "inlay_upstream_timeout", message: "The upstream provider could not complete this request." },
    });
    assert.equal((metrics.snapshot() as { totalRequests: number }).totalRequests, 0);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("GET /v1/models aborts its upstream request when the client disconnects", async () => {
  let upstreamClosed = false;
  let upstreamRequestReceived = false;
  const upstream = createServer((incoming) => {
    upstreamRequestReceived = true;
    incoming.socket.on("close", () => { upstreamClosed = true; });
  });
  const upstreamPort = await listen(upstream);
  const proxy = createInlayServer({
    host: "127.0.0.1", port: 0,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}/v1`),
    maxBodyBytes: 1024, upstreamTimeoutMs: 5_000, observationMode: "off",
  });
  const proxyPort = await listen(proxy);
  const client = request({ host: "127.0.0.1", port: proxyPort, path: "/v1/models", method: "GET" });
  client.on("error", () => {});
  client.end();
  try {
    await waitFor(() => upstreamRequestReceived);
    client.destroy();
    await waitFor(() => upstreamClosed);
  } finally {
    client.destroy();
    await close(proxy);
    await close(upstream);
  }
});
