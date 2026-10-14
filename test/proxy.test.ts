import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { once } from "node:events";
import { zstdCompressSync } from "node:zlib";
import { createInlayServer } from "../src/app.ts";
import { MetricsStore } from "../src/metrics.ts";
import { deriveResponsesRequestStructure, ExactItemRecurrenceTracker, MAX_EXACT_ITEM_RECURRENCE_BYTES, MAX_ZSTD_OBSERVATION_BYTES } from "../src/observation.ts";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
  return address.port;
}

async function close(server: Server): Promise<void> {
  server.close();
  await once(server, "close");
}

async function waitFor(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for proxy metric.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("issues process-local observation sequences and retains only the bounded metric window", () => {
  const metrics = new MetricsStore();
  assert.deepEqual([
    metrics.nextObservationSequence(),
    metrics.nextObservationSequence(),
    metrics.nextObservationSequence(),
  ], [1, 2, 3]);

  for (let index = 0; index < 101; index += 1) {
    metrics.record({
      requestId: "opaque-request-id",
      route: "/v1/responses",
      startedAt: "",
      durationMs: 0,
      requestBytes: 0,
    });
  }

  const snapshot = metrics.snapshot() as { totalRequests: number; recent: unknown[] };
  assert.equal(snapshot.totalRequests, 101);
  assert.equal(snapshot.recent.length, 100);
});

test("canonical structural bytes are independent of object key insertion order", () => {
  const left = deriveResponsesRequestStructure(Buffer.from(JSON.stringify({ input: [{ type: "message", alpha: "a", beta: "b" }] })));
  const right = deriveResponsesRequestStructure(Buffer.from(JSON.stringify({ input: [{ beta: "b", type: "message", alpha: "a" }] })));
  const leftInput = left?.topLevelFields.find((field) => field.name === "input");
  const rightInput = right?.topLevelFields.find((field) => field.name === "input");

  assert.ok(leftInput);
  assert.ok(rightInput);
  assert.equal(leftInput.canonicalJsonBytes, rightInput.canonicalJsonBytes);
  assert.equal(left?.canonicalStructuralBytesTotal, right?.canonicalStructuralBytesTotal);
});

test("aggregates canonical structural bytes by approved input item type", () => {
  const item = { type: "message" };
  const structure = deriveResponsesRequestStructure(Buffer.from(JSON.stringify({ input: [item, item] })));

  assert.deepEqual(structure?.inputItemTypeCounts, { message: 2 });
  assert.deepEqual(structure?.inputItemTypeCanonicalJsonBytes, {
    message: Buffer.byteLength(JSON.stringify(item), "utf8") * 2,
  });
});

test("groups unknown input item types as other without retaining their type string", () => {
  const structure = deriveResponsesRequestStructure(Buffer.from(JSON.stringify({
    input: [{ type: "PRIVATE_UNRECOGNIZED_TYPE", content: "PRIVATE_CONTENT" }],
  })));

  assert.deepEqual(structure?.inputItemTypeCounts, { other: 1 });
  assert.ok((structure?.inputItemTypeCanonicalJsonBytes?.other ?? 0) > 0);
  assert.doesNotMatch(JSON.stringify(structure), /PRIVATE_UNRECOGNIZED_TYPE|PRIVATE_CONTENT/);
});

test("reports aggregate exact-item recurrence without retaining scalar values or fingerprints", () => {
  const tracker = new ExactItemRecurrenceTracker();
  const item = { type: "function_call_output", call_id: "PRIVATE_CALL_ID", output: "PRIVATE_TOOL_OUTPUT" };
  const first = tracker.observe(1, Buffer.from(JSON.stringify({ input: [item] })), "identity");
  const second = tracker.observe(2, Buffer.from(JSON.stringify({ input: [{ output: "PRIVATE_TOOL_OUTPUT", type: "function_call_output", call_id: "PRIVATE_CALL_ID" }] })), "identity");
  const summary = tracker.snapshot();

  assert.equal(first.previouslySeenItemCount, 0);
  assert.equal(second.previouslySeenItemCount, 1);
  assert.equal(second.previouslySeenItemTypeCounts.function_call_output, 1);
  assert.equal(summary.recurringGroupCount, 1);
  assert.deepEqual(summary.groups[0] && {
    itemType: summary.groups[0].itemType,
    firstObservationSequence: summary.groups[0].firstObservationSequence,
    lastObservationSequence: summary.groups[0].lastObservationSequence,
    distinctRequestCount: summary.groups[0].distinctRequestCount,
  }, {
    itemType: "function_call_output",
    firstObservationSequence: 1,
    lastObservationSequence: 2,
    distinctRequestCount: 2,
  });
  assert.doesNotMatch(JSON.stringify({ first, second, summary }), /PRIVATE_CALL_ID|PRIVATE_TOOL_OUTPUT|[a-f0-9]{64}/);
});

test("classifies recurring items into fixed semantic roles without exposing raw types or values", () => {
  const tracker = new ExactItemRecurrenceTracker(true);
  const first = {
    input: [
      { type: "compaction", encrypted_content: "PRIVATE_PROTOCOL_STATE" },
      { type: "PRIVATE_CUSTOM_TOOL", secret: "PRIVATE_UNKNOWN_VALUE" },
      { type: "message", role: "developer", content: "PRIVATE_DEVELOPER_TEXT" },
    ],
  };
  tracker.observe(1, Buffer.from(JSON.stringify(first)), "identity");
  const repeated = tracker.observe(2, Buffer.from(JSON.stringify(first)), "identity");
  const summary = tracker.snapshot();

  assert.deepEqual(repeated.previouslySeenRoleCategoryCounts, {
    protocol_state: 1,
    unknown_item_type: 1,
    message_system_or_developer: 1,
  });
  assert.deepEqual(summary.groups.map((group) => group.semanticRoleCategory).sort(), [
    "message_system_or_developer",
    "protocol_state",
    "unknown_item_type",
  ]);
  assert.doesNotMatch(JSON.stringify({ repeated, summary }), /PRIVATE_PROTOCOL_STATE|PRIVATE_CUSTOM_TOOL|PRIVATE_UNKNOWN_VALUE|PRIVATE_DEVELOPER_TEXT/);
});

test("bounds exact-item recurrence input without retaining malformed content", () => {
  const tracker = new ExactItemRecurrenceTracker();
  const observation = tracker.observe(1, Buffer.alloc(MAX_EXACT_ITEM_RECURRENCE_BYTES + 1, 0x61), "identity");

  assert.equal(observation.unavailableReason, "input_limit");
  assert.equal(observation.comparisonIncomplete, true);
  assert.equal(tracker.snapshot().comparisonIncomplete, false);
});

test("correlates zstd exact-item recurrence without exposing payload values", () => {
  const tracker = new ExactItemRecurrenceTracker();
  const compressed = zstdCompressSync(Buffer.from(JSON.stringify({
    input: [{ type: "message", content: "ZSTD_PRIVATE_RECURRENCE_CONTENT" }],
  })));

  tracker.observe(1, compressed, "zstd");
  const second = tracker.observe(2, compressed, "zstd");
  const summary = tracker.snapshot();

  assert.equal(second.previouslySeenItemCount, 1);
  assert.equal(summary.recurringGroupCount, 1);
  assert.doesNotMatch(JSON.stringify({ second, summary }), /ZSTD_PRIVATE_RECURRENCE_CONTENT/);
});

test("marks malformed exact-item recurrence input incomplete without retaining it", () => {
  const tracker = new ExactItemRecurrenceTracker();
  const observation = tracker.observe(1, Buffer.from("PRIVATE_NOT_A_ZSTD_FRAME"), "zstd");

  assert.equal(observation.unavailableReason, "zstd_decode_failed");
  assert.equal(observation.comparisonIncomplete, true);
  assert.doesNotMatch(JSON.stringify(observation), /PRIVATE_NOT_A_ZSTD_FRAME/);
});

test("forwards an OpenAI-compatible streaming response without transforming it", async () => {
  const upstream = createServer(async (request, response) => {
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers["x-inlay-request-id"]?.length, 36);
    assert.equal(request.headers.authorization, "Bearer test-key");
    assert.equal(request.headers["x-provider-trace"], "trace-123");
    const received: Buffer[] = [];
    for await (const chunk of request) received.push(Buffer.from(chunk));
    assert.deepEqual(JSON.parse(Buffer.concat(received).toString("utf8")), {
      model: "test",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", function: { name: "list_files", parameters: { type: "object" } } }],
    });
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"list_files","arguments":"{\\\"path\\\":\\\"."}}]}}]}\n\n');
    setTimeout(() => response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\\"}"}}]}}]}\n\n'), 25);
    setTimeout(() => response.end('data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n\ndata: [DONE]\n\n'), 50);
  });
  const upstreamPort = await listen(upstream);
  const metrics = new MetricsStore();
  const proxy = createInlayServer({
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}/v1`),
    maxBodyBytes: 1024,
    upstreamTimeoutMs: 1_000,
    observationMode: "off",
  }, metrics);
  const proxyPort = await listen(proxy);

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key", "x-provider-trace": "trace-123" },
      body: JSON.stringify({
        model: "test",
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "user", content: "hello" }],
        tools: [{ type: "function", function: { name: "list_files", parameters: { type: "object" } } }],
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.match(response.headers.get("x-inlay-request-id") ?? "", /^[0-9a-f-]{36}$/);
    const reader = response.body?.getReader();
    assert.ok(reader);
    const first = await reader.read();
    assert.equal(new TextDecoder().decode(first.value), 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"list_files","arguments":"{\\\"path\\\":\\\"."}}]}}]}\n\n');
    const remaining: Uint8Array[] = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value) remaining.push(next.value);
    }
    assert.equal(new TextDecoder().decode(Buffer.concat(remaining)), 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\\"}"}}]}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n\ndata: [DONE]\n\n');

    const snapshot = metrics.snapshot() as { totalRequests: number; recent: Array<{ route: string; responseStatus: number; timeToUpstreamHeadersMs: number; requestBytes: number }> };
    assert.equal(snapshot.totalRequests, 1);
    assert.equal(snapshot.recent[0].route, "/v1/chat/completions");
    assert.equal(snapshot.recent[0].responseStatus, 200);
    assert.ok(snapshot.recent[0].timeToUpstreamHeadersMs >= 0);
    assert.ok(snapshot.recent[0].requestBytes > 0);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("forwards the exact Pi Codex Responses alias request without interpreting it", async () => {
  const requestBody = JSON.stringify({
    model: "test",
    stream: true,
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "PRIVATE_PROMPT" }] },
      { type: "function_call_output", call_id: "call-private", output: "PRIVATE_TOOL_OUTPUT" },
    ],
    client_metadata: { cwd: "C:\\private\\project" },
  });
  const firstEvent = 'event: response.output_text.delta\ndata: {"delta":"INLAY_ROUTE_OK"}\n\n';
  const completedEvent = 'event: response.completed\ndata: {"response":{"usage":{"input_tokens":12,"output_tokens":8,"total_tokens":20,"input_tokens_details":{"cached_tokens":3}}}}\n\n';
  const upstream = createServer(async (request, response) => {
    assert.equal(request.url, "/backend-api/codex/responses");
    assert.equal(request.headers.authorization, "Bearer subscription-token");
    const received: Buffer[] = [];
    for await (const chunk of request) received.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(received).toString("utf8"), requestBody);
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(firstEvent);
    setTimeout(() => {
      response.write(completedEvent.slice(0, 37));
      response.end(completedEvent.slice(37));
    }, 10);
  });
  const upstreamPort = await listen(upstream);
  const metrics = new MetricsStore();
  const proxy = createInlayServer({
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}/backend-api/codex`),
    maxBodyBytes: 1024,
    upstreamTimeoutMs: 1_000,
    observationMode: "structural",
    timelineMode: "content-free",
  }, metrics);
  const proxyPort = await listen(proxy);

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/codex/responses`, {
      method: "POST",
      headers: { authorization: "Bearer subscription-token", "content-type": "application/json" },
      body: requestBody,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    const reader = response.body?.getReader();
    assert.ok(reader);
    const first = await reader.read();
    assert.equal(new TextDecoder().decode(first.value), firstEvent);
    const remaining: Uint8Array[] = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value) remaining.push(next.value);
    }
    assert.equal(new TextDecoder().decode(Buffer.concat(remaining)), completedEvent);

    const snapshot = metrics.snapshot() as {
      totalRequests: number;
      recent: Array<{
        observationSequence?: number;
        route: string;
        responseStatus: number;
        responseBytes?: number;
        completed?: boolean;
        cancelled?: boolean;
        terminalEventObserved?: boolean;
        timeToUpstreamHeadersMs?: number;
        timeToFirstResponseBodyByteMs?: number;
        timeline?: {
          requestStartedAtMs: number;
          upstreamHeadersAtMs?: number;
          firstResponseBodyByteAtMs?: number;
          terminalEventAtMs?: number;
          completedAtMs: number;
          retryClassification: "unavailable";
        };
        requestStructure?: { canonicalStructuralBytesTotal?: number; inputItemCount?: number; inputItemTypeCounts?: Record<string, number>; inputItemTypeCanonicalJsonBytes?: Record<string, number>; topLevelFields: Array<{ name: string }> };
        usage?: Record<string, number>;
      }>;
    };
    assert.equal(snapshot.totalRequests, 1);
    assert.equal(snapshot.recent[0].observationSequence, 1);
    assert.equal(snapshot.recent[0].route, "/v1/codex/responses");
    assert.equal(snapshot.recent[0].responseStatus, 200);
    assert.equal(snapshot.recent[0].responseBytes, Buffer.byteLength(firstEvent + completedEvent));
    assert.equal(snapshot.recent[0].completed, true);
    assert.equal(snapshot.recent[0].cancelled, false);
    assert.equal(snapshot.recent[0].terminalEventObserved, true);
    assert.ok(snapshot.recent[0].timeToUpstreamHeadersMs !== undefined);
    assert.ok(snapshot.recent[0].timeToFirstResponseBodyByteMs !== undefined);
    assert.ok(snapshot.recent[0].timeline);
    assert.ok((snapshot.recent[0].timeline?.upstreamHeadersAtMs ?? 0) >= snapshot.recent[0].timeline!.requestStartedAtMs);
    assert.ok((snapshot.recent[0].timeline?.firstResponseBodyByteAtMs ?? 0) >= snapshot.recent[0].timeline!.requestStartedAtMs);
    assert.ok((snapshot.recent[0].timeline?.terminalEventAtMs ?? 0) >= snapshot.recent[0].timeline!.requestStartedAtMs);
    assert.ok(snapshot.recent[0].timeline!.completedAtMs >= snapshot.recent[0].timeline!.requestStartedAtMs);
    assert.equal(snapshot.recent[0].timeline?.retryClassification, "unavailable");
    assert.deepEqual(snapshot.recent[0].usage, { inputTokens: 12, outputTokens: 8, totalTokens: 20, cachedInputTokens: 3 });
    assert.equal(snapshot.recent[0].requestStructure?.inputItemCount, 2);
    assert.ok((snapshot.recent[0].requestStructure?.canonicalStructuralBytesTotal ?? 0) > 0);
    assert.deepEqual(snapshot.recent[0].requestStructure?.inputItemTypeCounts, { message: 1, function_call_output: 1 });
    assert.ok((snapshot.recent[0].requestStructure?.inputItemTypeCanonicalJsonBytes?.message ?? 0) > 0);
    assert.ok((snapshot.recent[0].requestStructure?.inputItemTypeCanonicalJsonBytes?.function_call_output ?? 0) > 0);
    assert.deepEqual(snapshot.recent[0].requestStructure?.topLevelFields.map((field) => field.name), ["client_metadata", "input", "model", "stream"]);
    assert.doesNotMatch(JSON.stringify(snapshot.recent[0]), /PRIVATE_PROMPT|PRIVATE_TOOL_OUTPUT|private\\project|subscription-token|call-private/);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("forwards GET model discovery while keeping non-POST alias requests unsupported", async () => {
  const proxy = createInlayServer({
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl: new URL("http://127.0.0.1:1/backend-api/codex"),
    maxBodyBytes: 1024,
    upstreamTimeoutMs: 1_000,
    observationMode: "off",
  });
  const proxyPort = await listen(proxy);

  try {
    const models = await fetch(`http://127.0.0.1:${proxyPort}/v1/models`);
    assert.equal(models.status, 502);
    assert.equal((await models.json() as { error?: { code?: string } }).error?.code, "inlay_upstream_unavailable");

    const alias = await fetch(`http://127.0.0.1:${proxyPort}/v1/codex/responses`);
    assert.equal(alias.status, 404);
    assert.equal((await alias.json() as { error?: { code?: string } }).error?.code, "inlay_route_not_found");
  } finally {
    await close(proxy);
  }
});

test("records a client disconnect after response.completed as a transport cancellation", async () => {
  let interval: NodeJS.Timeout | undefined;
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('event: response.completed\ndata: {"type":"response.completed","detail":"PRIVATE_STREAM_CONTENT"}\n\n');
    interval = setInterval(() => response.write(': keepalive\n\n'), 10);
    response.once("close", () => clearInterval(interval));
  });
  const upstreamPort = await listen(upstream);
  const metrics = new MetricsStore();
  const proxy = createInlayServer({
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}/backend-api/codex`),
    maxBodyBytes: 1024,
    upstreamTimeoutMs: 1_000,
    observationMode: "structural",
  }, metrics);
  const proxyPort = await listen(proxy);

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
      method: "POST",
      body: JSON.stringify({ input: [{ type: "message", content: "PRIVATE_PROMPT" }] }),
    });
    const reader = response.body?.getReader();
    assert.ok(reader);
    await reader.read();
    await reader.cancel();

    await waitFor(() => (metrics.snapshot() as { totalRequests: number }).totalRequests === 1);
    const metric = (metrics.snapshot() as { recent: Array<{ completed?: boolean; cancelled?: boolean; terminalEventObserved?: boolean; cancelledAfterTerminalEvent?: boolean; responseBytes?: number; errorCategory?: string }> }).recent[0];
    assert.equal(metric.completed, false);
    assert.equal(metric.cancelled, true);
    assert.equal(metric.terminalEventObserved, true);
    assert.equal(metric.cancelledAfterTerminalEvent, true);
    assert.equal(metric.errorCategory, "client_disconnect");
    assert.ok((metric.responseBytes ?? 0) > 0);
    assert.doesNotMatch(JSON.stringify(metric), /PRIVATE_STREAM_CONTENT|PRIVATE_PROMPT/);
  } finally {
    clearInterval(interval);
    await close(proxy);
    await close(upstream);
  }
});

test("marks an oversized SSE event as observation-incomplete while forwarding it unchanged", async () => {
  const event = `event: response.output_text.delta\ndata: ${JSON.stringify({ delta: "x".repeat(64 * 1024) })}\n\n`;
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(event);
  });
  const upstreamPort = await listen(upstream);
  const metrics = new MetricsStore();
  const proxy = createInlayServer({
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}/backend-api/codex`),
    maxBodyBytes: 1024,
    upstreamTimeoutMs: 1_000,
    observationMode: "structural",
  }, metrics);
  const proxyPort = await listen(proxy);

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, { method: "POST", body: "{}" });
    assert.equal(await response.text(), event);
    const metric = (metrics.snapshot() as { recent: Array<{ responseObservationIncomplete?: boolean }> }).recent[0];
    assert.equal(metric.responseObservationIncomplete, true);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("marks an unterminated SSE event as observation-incomplete while forwarding it unchanged", async () => {
  const event = 'event: response.completed\ndata: {"type":"response.completed"}';
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(event);
  });
  const upstreamPort = await listen(upstream);
  const metrics = new MetricsStore();
  const proxy = createInlayServer({
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}/backend-api/codex`),
    maxBodyBytes: 1024,
    upstreamTimeoutMs: 1_000,
    observationMode: "structural",
  }, metrics);
  const proxyPort = await listen(proxy);

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, { method: "POST", body: "{}" });
    assert.equal(await response.text(), event);
    const metric = (metrics.snapshot() as { recent: Array<{ responseObservationIncomplete?: boolean; terminalEventObserved?: boolean }> }).recent[0];
    assert.equal(metric.responseObservationIncomplete, true);
    assert.equal(metric.terminalEventObserved, false);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("observes a zstd Responses request while forwarding its compressed bytes unchanged", async () => {
  const privateBody = JSON.stringify({
    model: "test",
    input: [
      { type: "message", content: "ZSTD_PRIVATE_PROMPT" },
      { type: "function_call_output", output: "ZSTD_PRIVATE_TOOL_OUTPUT" },
    ],
  });
  const compressedBody = zstdCompressSync(Buffer.from(privateBody));
  const upstream = createServer(async (request, response) => {
    assert.equal(request.headers["content-encoding"], "zstd");
    const received: Buffer[] = [];
    for await (const chunk of request) received.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(received), compressedBody);
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('event: response.completed\ndata: {"type":"response.completed"}\n\n');
  });
  const upstreamPort = await listen(upstream);
  const metrics = new MetricsStore();
  const proxy = createInlayServer({
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}/backend-api/codex`),
    maxBodyBytes: 1024,
    upstreamTimeoutMs: 1_000,
    observationMode: "structural",
  }, metrics);
  const proxyPort = await listen(proxy);

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
      method: "POST",
      headers: { "content-encoding": "zstd" },
      body: new Uint8Array(compressedBody),
    });
    await response.text();
    const metric = (metrics.snapshot() as { recent: Array<{
      requestContentEncoding?: string;
      requestStructure?: { inputItemCount?: number; inputItemTypeCounts?: Record<string, number>; inputItemTypeCanonicalJsonBytes?: Record<string, number> };
      requestStructureUnavailableReason?: string;
    }> }).recent[0];
    assert.equal(metric.requestContentEncoding, "zstd");
    assert.equal(metric.requestStructureUnavailableReason, undefined);
    assert.equal(metric.requestStructure?.inputItemCount, 2);
    assert.deepEqual(metric.requestStructure?.inputItemTypeCounts, { message: 1, function_call_output: 1 });
    assert.ok((metric.requestStructure?.inputItemTypeCanonicalJsonBytes?.message ?? 0) > 0);
    assert.ok((metric.requestStructure?.inputItemTypeCanonicalJsonBytes?.function_call_output ?? 0) > 0);
    assert.doesNotMatch(JSON.stringify(metric), /ZSTD_PRIVATE_PROMPT|ZSTD_PRIVATE_TOOL_OUTPUT/);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("records malformed zstd as unavailable while forwarding it unchanged", async () => {
  const malformedBody = Buffer.from("not-a-zstd-frame");
  const upstream = createServer(async (request, response) => {
    const received: Buffer[] = [];
    for await (const chunk of request) received.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(received), malformedBody);
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('event: response.completed\ndata: {"type":"response.completed"}\n\n');
  });
  const upstreamPort = await listen(upstream);
  const metrics = new MetricsStore();
  const proxy = createInlayServer({
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}/backend-api/codex`),
    maxBodyBytes: 1024,
    upstreamTimeoutMs: 1_000,
    observationMode: "structural",
  }, metrics);
  const proxyPort = await listen(proxy);

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
      method: "POST",
      headers: { "content-encoding": "zstd" },
      body: new Uint8Array(malformedBody),
    });
    assert.equal(response.status, 200);
    await response.text();
    const metric = (metrics.snapshot() as { recent: Array<{ requestStructure?: unknown; requestStructureUnavailableReason?: string }> }).recent[0];
    assert.equal(metric.requestStructure, undefined);
    assert.equal(metric.requestStructureUnavailableReason, "zstd_decode_failed");
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("does not observe zstd when structural observation is disabled", async () => {
  const malformedBody = Buffer.from("not-a-zstd-frame");
  const upstream = createServer(async (request, response) => {
    const received: Buffer[] = [];
    for await (const chunk of request) received.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(received), malformedBody);
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('event: response.completed\ndata: {"type":"response.completed"}\n\n');
  });
  const upstreamPort = await listen(upstream);
  const metrics = new MetricsStore();
  const proxy = createInlayServer({
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}/backend-api/codex`),
    maxBodyBytes: 1024,
    upstreamTimeoutMs: 1_000,
    observationMode: "off",
  }, metrics);
  const proxyPort = await listen(proxy);

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
      method: "POST",
      headers: { "content-encoding": "zstd" },
      body: new Uint8Array(malformedBody),
    });
    assert.equal(response.status, 200);
    await response.text();
    const metric = (metrics.snapshot() as { recent: Array<{ requestContentEncoding?: string; requestStructure?: unknown; requestStructureUnavailableReason?: string }> }).recent[0];
    assert.equal(metric.requestContentEncoding, undefined);
    assert.equal(metric.requestStructure, undefined);
    assert.equal(metric.requestStructureUnavailableReason, undefined);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("bounds zstd observation output while preserving forwarding", async () => {
  const compressedBody = zstdCompressSync(Buffer.alloc(MAX_ZSTD_OBSERVATION_BYTES + 1, 0x61));
  const upstream = createServer(async (request, response) => {
    const received: Buffer[] = [];
    for await (const chunk of request) received.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(received), compressedBody);
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('event: response.completed\ndata: {"type":"response.completed"}\n\n');
  });
  const upstreamPort = await listen(upstream);
  const metrics = new MetricsStore();
  const proxy = createInlayServer({
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}/backend-api/codex`),
    maxBodyBytes: 1024,
    upstreamTimeoutMs: 1_000,
    observationMode: "structural",
  }, metrics);
  const proxyPort = await listen(proxy);

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/responses`, {
      method: "POST",
      headers: { "content-encoding": "zstd" },
      body: new Uint8Array(compressedBody),
    });
    assert.equal(response.status, 200);
    await response.text();
    const metric = (metrics.snapshot() as { recent: Array<{ requestStructure?: unknown; requestStructureUnavailableReason?: string }> }).recent[0];
    assert.equal(metric.requestStructure, undefined);
    assert.equal(metric.requestStructureUnavailableReason, "zstd_output_limit");
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("preserves an upstream status and error body", async () => {
  const upstream = createServer((_request, response) => {
    response.writeHead(429, { "content-type": "application/json", "retry-after": "2" });
    response.end('{"error":{"message":"rate limited","type":"rate_limit_error"}}');
  });
  const upstreamPort = await listen(upstream);
  const proxy = createInlayServer({
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl: new URL(`http://127.0.0.1:${upstreamPort}/v1`),
    maxBodyBytes: 1024,
    upstreamTimeoutMs: 1_000,
    observationMode: "off",
  });
  const proxyPort = await listen(proxy);

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "2");
    assert.equal(await response.text(), '{"error":{"message":"rate limited","type":"rate_limit_error"}}');
  } finally {
    await close(proxy);
    await close(upstream);
  }
});
