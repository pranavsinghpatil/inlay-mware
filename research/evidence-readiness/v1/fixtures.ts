import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { setImmediate as nextTurn } from "node:timers/promises";
import { gzipSync, zstdCompressSync } from "node:zlib";
import { createInlayServer } from "../../../src/app.ts";
import { MetricsStore, type RequestMetric } from "../../../src/metrics.ts";
import { ExactItemRecurrenceTracker, MAX_ZSTD_OBSERVATION_BYTES, ResponsesStreamObserver } from "../../../src/observation.ts";

export type Facts = Record<string, string | number | boolean | null>;
export interface FixtureResult { measurements: Facts; checks: Array<{ id: string; passed: boolean }> }

const requestValue = () => ({ input: [{ type: "message", role: "user", content: [] }] });
const requestBytes = () => Buffer.from(JSON.stringify(requestValue()));
const frame = (event: string, value: unknown) =>
  Buffer.from("event: " + event + "\ndata: " + (typeof value === "string" ? value : JSON.stringify(value)) + "\n\n");
const completedFrame = (usage?: unknown) => frame("response.completed", { type: "response.completed", ...(usage ? { response: { usage } } : {}) });
const fullUsage = { input_tokens: 12, output_tokens: 8, total_tokens: 20, input_tokens_details: { cached_tokens: 0 } };

function result(measurements: Facts, checks: Record<string, boolean>): FixtureResult {
  return { measurements, checks: Object.entries(checks).map(([id, passed]) => ({ id, passed })) };
}

function observe(bytes: Buffer) {
  const observer = new ResponsesStreamObserver();
  observer.observe(bytes, 5);
  observer.finish();
  return observer.snapshot();
}

function usageFacts(usage: RequestMetric["usage"]): Facts {
  return {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    cachedInputTokens: usage?.cachedInputTokens ?? null,
  };
}

function observerFacts(value: ReturnType<ResponsesStreamObserver["snapshot"]>): Facts {
  return {
    ...usageFacts(value.usage),
    responseBytes: value.responseBytes,
    firstBodyTimingObserved: value.timeToFirstResponseBodyByteMs !== undefined,
    completionMarkerObserved: value.terminalEventObserved,
    knownParserIncomplete: value.responseObservationIncomplete,
  };
}

export function equalFacts(left: Facts, right: Facts): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function padFrames(left: Buffer, right: Buffer): [Buffer, Buffer] {
  const length = Math.max(left.length, right.length);
  const pad = (bytes: Buffer) => Buffer.concat([bytes.subarray(0, -2), Buffer.alloc(length - bytes.length, 32), bytes.subarray(-2)]);
  return [pad(left), pad(right)];
}

async function deadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("fixture_deadline")), 5_000); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture_address");
  return address.port;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

class ObservedStore extends MetricsStore {
  recorded: RequestMetric[] = [];
  #waiters: Array<{ count: number; resolve: () => void }> = [];
  override record(metric: RequestMetric): void {
    super.record(metric);
    this.recorded.push(metric);
    for (const waiter of this.#waiters.filter((entry) => entry.count <= this.recorded.length)) waiter.resolve();
    this.#waiters = this.#waiters.filter((entry) => entry.count > this.recorded.length);
  }
  waitFor(count: number): Promise<void> {
    return this.recorded.length >= count ? Promise.resolve() : deadline(new Promise<void>((resolve) => this.#waiters.push({ count, resolve })));
  }
}

interface ExchangeOptions { body?: Buffer; encoding?: string; status?: number; cancel?: boolean; repetitions?: number }
async function exchange(responseBytes: Buffer, options: ExchangeOptions = {}) {
  const body = options.body ?? requestBytes();
  const store = new ObservedStore();
  let requestPreserved = true;
  const upstream = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requestPreserved = requestPreserved && Buffer.concat(chunks).equals(body);
    response.writeHead(options.status ?? 200, { "content-type": "text/event-stream" });
    if (options.cancel) response.write(responseBytes);
    else response.end(responseBytes);
  });
  let proxy: Server | undefined;
  try {
    const port = await listen(upstream);
    proxy = createInlayServer({
      host: "127.0.0.1", port: 0, upstreamBaseUrl: new URL("http://127.0.0.1:" + port + "/v1"),
      maxBodyBytes: 2 * 1024 * 1024, upstreamTimeoutMs: 4_000, observationMode: "structural",
    }, store);
    const proxyPort = await listen(proxy);
    let responsePreserved = true;
    let statusPreserved = true;
    for (let repetition = 1; repetition <= (options.repetitions ?? 1); repetition++) {
      const response = await deadline(fetch("http://127.0.0.1:" + proxyPort + "/v1/responses", {
        method: "POST", body: new Uint8Array(body),
        headers: { "content-type": "application/json", ...(options.encoding ? { "content-encoding": options.encoding } : {}) },
      }));
      statusPreserved = statusPreserved && response.status === (options.status ?? 200);
      if (options.cancel) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("fixture_reader");
        const received: Buffer[] = [];
        let receivedLength = 0;
        while (receivedLength < responseBytes.length) {
          const next = await deadline(reader.read());
          if (next.done) break;
          const chunk = Buffer.from(next.value ?? []);
          received.push(chunk);
          receivedLength += chunk.length;
        }
        responsePreserved = responsePreserved && Buffer.concat(received).equals(responseBytes);
        await reader.cancel();
      } else {
        responsePreserved = responsePreserved && Buffer.from(await deadline(response.arrayBuffer())).equals(responseBytes);
      }
      await store.waitFor(repetition);
    }
    return { metric: store.recorded[0], metrics: store.recorded, storeFacts: storeFacts(store), requestPreserved, responsePreserved, statusPreserved };
  } finally {
    if (proxy) await close(proxy);
    await close(upstream);
  }
}

function preservation(value: Awaited<ReturnType<typeof exchange>>) {
  return { request_preserved: value.requestPreserved, response_preserved: value.responsePreserved, status_preserved: value.statusPreserved };
}

function storeFacts(store: MetricsStore): Facts {
  const snapshot = store.snapshot() as { totalRequests: number; recent: RequestMetric[] };
  return { recordedCount: snapshot.totalRequests, retainedCount: snapshot.recent.length };
}

function metricFixture(sequence: number, status = 200): RequestMetric {
  return { requestId: "synthetic", route: "/v1/responses", startedAt: "", durationMs: 1, requestBytes: 1, observationSequence: sequence, responseStatus: status };
}

async function zeroRecorded(upstreamConfigured: boolean): Promise<{ facts: Facts; expectedStatus: boolean }> {
  const store = new MetricsStore();
  const proxy = createInlayServer({
    host: "127.0.0.1", port: 0, upstreamBaseUrl: upstreamConfigured ? new URL("http://127.0.0.1:1/v1") : undefined,
    maxBodyBytes: 1024, upstreamTimeoutMs: 100, observationMode: "structural",
  }, store);
  try {
    const port = await listen(proxy);
    const response = await deadline(fetch("http://127.0.0.1:" + port + (upstreamConfigured ? "/unsupported" : "/v1/responses"), { method: "POST", body: new Uint8Array(requestBytes()) }));
    await response.arrayBuffer();
    return { facts: storeFacts(store), expectedStatus: response.status === (upstreamConfigured ? 404 : 503) };
  } finally { await close(proxy); }
}

async function inflightEquivalence(): Promise<FixtureResult> {
  const store = new ObservedStore();
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let count = 0;
  const wire = completedFrame();
  const upstream = createServer(async (request, response) => {
    for await (const _chunk of request) { /* transient input only */ }
    count += 1;
    if (count === 2) { entered(); await gate; }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(wire);
  });
  let proxy: Server | undefined;
  let pending: Promise<Response> | undefined;
  try {
    const upstreamPort = await listen(upstream);
    proxy = createInlayServer({
      host: "127.0.0.1", port: 0, upstreamBaseUrl: new URL("http://127.0.0.1:" + upstreamPort + "/v1"),
      maxBodyBytes: 1024, upstreamTimeoutMs: 4_000, observationMode: "structural",
    }, store);
    const port = await listen(proxy);
    const send = () => fetch("http://127.0.0.1:" + port + "/v1/responses", { method: "POST", body: new Uint8Array(requestBytes()) });
    const first = await deadline(send());
    const firstBytesPreserved = Buffer.from(await first.arrayBuffer()).equals(wire);
    await store.waitFor(1);
    const idle = storeFacts(store);
    pending = send();
    await deadline(started);
    const during = storeFacts(store);
    await nextTurn();
    const stable = storeFacts(store);
    const indistinguishable = equalFacts(idle, during) && equalFacts(during, stable);
    release();
    const second = await deadline(pending);
    const secondBytesPreserved = Buffer.from(await second.arrayBuffer()).equals(wire);
    await store.waitFor(2);
    return result({ ...during, snapshotsStable: equalFacts(during, stable) }, {
      in_flight_and_idle_projections_equal: indistinguishable,
      supported_second_request_reached_upstream: count === 2,
      late_outcome_eventually_recorded: storeFacts(store).recordedCount === 2,
      response_preserved: firstBytesPreserved && secondBytesPreserved,
    });
  } finally {
    release();
    await pending?.then((response) => response.arrayBuffer()).catch(() => undefined);
    if (proxy) await close(proxy);
    await close(upstream);
  }
}

export async function runFixture(id: string): Promise<FixtureResult> {
  switch (id) {
    case "C01": {
      const value = await exchange(completedFrame());
      return result({ structureObserved: value.metric.requestStructure !== undefined, inputItems: value.metric.requestStructure?.inputItemCount ?? null, encoding: value.metric.requestContentEncoding ?? "other" }, preservation(value));
    }
    case "C02": {
      const value = await exchange(completedFrame(), { body: zstdCompressSync(requestBytes()), encoding: "zstd" });
      return result({ structureObserved: value.metric.requestStructure !== undefined, inputItems: value.metric.requestStructure?.inputItemCount ?? null, encoding: value.metric.requestContentEncoding ?? "other", wirePreserved: value.requestPreserved }, preservation(value));
    }
    case "C03": {
      const value = observe(completedFrame(fullUsage));
      return result(usageFacts(value.usage), { numeric_zero_retained: value.usage?.cachedInputTokens === 0, complete_encountered_tuple: value.usage?.inputTokens === 12 && value.usage.outputTokens === 8 && value.usage.totalTokens === 20 });
    }
    case "C04": {
      const value = await exchange(completedFrame());
      const metric = value.metric;
      return result({ headerTimingObserved: metric.timeToUpstreamHeadersMs !== undefined, firstBodyTimingObserved: metric.timeToFirstResponseBodyByteMs !== undefined, durationObserved: Number.isFinite(metric.durationMs) }, {
        ...preservation(value),
        local_timing_order: (metric.timeToUpstreamHeadersMs ?? -1) >= 0 && (metric.timeToFirstResponseBodyByteMs ?? -1) >= (metric.timeToUpstreamHeadersMs ?? 0) && metric.durationMs >= (metric.timeToFirstResponseBodyByteMs ?? 0),
      });
    }
    case "C05": {
      const tracker = new ExactItemRecurrenceTracker();
      const initial = tracker.observe(1, requestBytes(), "identity");
      const reordered = Buffer.from(JSON.stringify({ input: [{ content: [], role: "user", type: "message" }] }));
      const later = tracker.observe(2, reordered, "identity");
      return result({ recurrenceCompared: later.comparedItemCount, recurrencePreviouslySeen: later.previouslySeenItemCount, recurrenceIncomplete: later.comparisonIncomplete }, { initial_has_no_previous_match: initial.previouslySeenItemCount === 0, key_reordering_matches: later.previouslySeenItemCount === 1 });
    }
    case "C06": {
      const after = await exchange(completedFrame(), { cancel: true });
      const before = await exchange(frame("response.output_text.delta", { type: "response.output_text.delta", delta: 0 }), { cancel: true });
      return result({ pipelineCompleted: after.metric.completed ?? false, cancelled: after.metric.cancelled ?? false, cancelledAfterMarker: after.metric.cancelledAfterTerminalEvent ?? false, completionMarkerObserved: after.metric.terminalEventObserved ?? false }, {
        ...preservation(after), before_response_preserved: before.responsePreserved, both_are_client_disconnects: after.metric.errorCategory === "client_disconnect" && before.metric.errorCategory === "client_disconnect",
        before_marker_distinguished: before.metric.cancelled === true && before.metric.cancelledAfterTerminalEvent === false && before.metric.terminalEventObserved === false,
      });
    }
    case "C07": {
      const value = observe(completedFrame({ input_tokens: 12 }));
      return result(usageFacts(value.usage), { output_is_absent: value.usage?.outputTokens === undefined, input_is_present: value.usage?.inputTokens === 12 });
    }
    case "C08": {
      const value = observe(completedFrame({ input_tokens: 12, output_tokens: -1, total_tokens: "20", input_tokens_details: { cached_tokens: 0 } }));
      return result(usageFacts(value.usage), { invalid_numeric_fields_ignored: value.usage?.outputTokens === undefined && value.usage?.totalTokens === undefined, zero_still_retained: value.usage?.cachedInputTokens === 0 });
    }
    case "C09": {
      const bytes = frame("response.completed", " ".repeat(65_537) + "{}");
      const value = observe(bytes);
      return result({ responseBytesObserved: value.responseBytes > 0, firstBodyTimingObserved: value.timeToFirstResponseBodyByteMs !== undefined, knownParserIncomplete: value.responseObservationIncomplete, completionMarkerObserved: value.terminalEventObserved }, { byte_count_survives_limit: value.responseBytes === bytes.length, pending_cap_detected: value.responseObservationIncomplete });
    }
    case "C10": {
      const bytes = completedFrame().subarray(0, -2);
      const value = observe(bytes);
      return result({ responseBytesObserved: value.responseBytes > 0, knownParserIncomplete: value.responseObservationIncomplete, completionMarkerObserved: value.terminalEventObserved }, { final_pending_frame_detected: value.responseObservationIncomplete, byte_count_retained: value.responseBytes === bytes.length });
    }
    case "C11": {
      const first = new MetricsStore();
      const alternative = new MetricsStore();
      first.record(metricFixture(1, 200)); alternative.record(metricFixture(1, 500));
      for (let sequence = 2; sequence <= 101; sequence++) { first.record(metricFixture(sequence)); alternative.record(metricFixture(sequence)); }
      const firstRows = (first.snapshot() as { recent: RequestMetric[] }).recent;
      const alternativeRows = (alternative.snapshot() as { recent: RequestMetric[] }).recent;
      return result(storeFacts(first), { evicted_status_difference_hidden: firstRows.every((row, index) => row.responseStatus === alternativeRows[index].responseStatus), independent_count_is_101: storeFacts(first).recordedCount === 101, window_is_100: firstRows.length === 100 });
    }
    case "C12": {
      const tracker = new ExactItemRecurrenceTracker();
      const items = Array.from({ length: 513 }, (_value, ordinal) => ({ type: "message", role: "user", content: [], ordinal }));
      tracker.observe(1, Buffer.from(JSON.stringify({ input: items })), "identity");
      const second = tracker.observe(2, Buffer.from(JSON.stringify({ input: items.slice(0, 65) })), "identity");
      const summary = tracker.snapshot();
      const limited = new ExactItemRecurrenceTracker().observe(1, Buffer.alloc(1_048_577, 32), "identity");
      return result({ recurrencePreviouslySeen: second.previouslySeenItemCount, recurrenceIncomplete: second.comparisonIncomplete, recurringGroups: summary.recurringGroupCount, exposedGroups: summary.groups.length, recurringGroupsTruncated: summary.groupsTruncated }, {
        group_capacity_detected: summary.comparisonIncomplete,
        exposed_group_cap_detected: summary.groupsTruncated && summary.groups.length === 64,
        separate_input_limit_unavailable: limited.unavailableReason === "input_limit" && limited.comparisonIncomplete,
      });
    }
    case "C13": {
      const value = observe(completedFrame());
      return result(usageFacts(value.usage), { no_usage_is_not_zero: value.usage === undefined, recognized_completion_without_usage: value.terminalEventObserved });
    }
    case "C14":
    case "C15":
    case "C16": {
      const body = id === "C14" ? gzipSync(requestBytes()) : id === "C15" ? Buffer.from([0, 1, 2, 3]) : zstdCompressSync(Buffer.alloc(MAX_ZSTD_OBSERVATION_BYTES + 1, 32));
      const encoding = id === "C14" ? "gzip" : "zstd";
      const value = await exchange(completedFrame(), { body, encoding });
      return result({ structureObserved: value.metric.requestStructure !== undefined, structureUnavailableReason: value.metric.requestStructureUnavailableReason ?? "not_json", encoding: value.metric.requestContentEncoding ?? "other", wirePreserved: value.requestPreserved }, preservation(value));
    }
    case "C17": {
      const value = await exchange(Buffer.alloc(0), { status: 204 });
      return result({ status: value.metric.responseStatus ?? null, pipelineCompleted: value.metric.completed ?? false, headerTimingObserved: value.metric.timeToUpstreamHeadersMs !== undefined, firstBodyTimingObserved: value.metric.timeToFirstResponseBodyByteMs !== undefined }, preservation(value));
    }
    case "C18": {
      const value = await exchange(completedFrame());
      const declarations = { verifier: "FAIL", scope: "PASS", harnessCompletion: "PASS" } as const;
      return result({ status: value.metric.responseStatus ?? null, completionMarkerObserved: value.metric.terminalEventObserved ?? false, ...declarations }, {
        ...preservation(value), sidecar_is_explicitly_external: !("verifier" in value.metric) && !("scope" in value.metric) && !("harnessCompletion" in value.metric),
        failure_is_not_overridden_by_http: declarations.verifier === "FAIL" && value.metric.responseStatus === 200,
      });
    }
    case "C19": {
      const [malformed, absent] = padFrames(frame("response.output_text.delta", "{"), frame("response.output_text.delta", {}));
      const left = observe(malformed); const right = observe(absent);
      return result({ ...usageFacts(left.usage), knownParserIncomplete: left.responseObservationIncomplete, completionMarkerObserved: left.terminalEventObserved }, {
        different_wire_inputs: !malformed.equals(absent),
        all_approved_observer_facts_equal: equalFacts(observerFacts(left), observerFacts(right)),
        malformed_input_not_flagged: left.responseObservationIncomplete === false,
      });
    }
    case "C20": {
      const [failed, incomplete] = padFrames(frame("response.failed", { type: "response.failed" }), frame("response.incomplete", { type: "response.incomplete" }));
      const left = await exchange(failed); const right = await exchange(incomplete);
      const project = (metric: RequestMetric): Facts => ({ status: metric.responseStatus ?? null, pipelineCompleted: metric.completed ?? false, completionMarkerObserved: metric.terminalEventObserved ?? false, knownParserIncomplete: metric.responseObservationIncomplete ?? false, responseBytes: metric.responseBytes ?? null, ...usageFacts(metric.usage), headerTimingObserved: metric.timeToUpstreamHeadersMs !== undefined, firstBodyTimingObserved: metric.timeToFirstResponseBodyByteMs !== undefined });
      return result({ status: left.metric.responseStatus ?? null, pipelineCompleted: left.metric.completed ?? false, completionMarkerObserved: left.metric.terminalEventObserved ?? false, knownParserIncomplete: left.metric.responseObservationIncomplete ?? false }, {
        ...preservation(left), alternative_response_preserved: right.responsePreserved, distinct_event_families: !failed.equals(incomplete), approved_semantic_projections_equal: equalFacts(project(left.metric), project(right.metric)),
      });
    }
    case "C21": {
      const unsupported = await zeroRecorded(true); const unconfigured = await zeroRecorded(false);
      return result(unsupported.facts, { attempted_routes_return_expected_status: unsupported.expectedStatus && unconfigured.expectedStatus, approved_count_projections_equal: equalFacts(unsupported.facts, unconfigured.facts) });
    }
    case "C22": return inflightEquivalence();
    case "C23": {
      // Scheduling intent is an external label; both worlds send the same two requests.
      const independent = await exchange(completedFrame(), { repetitions: 2 });
      const retry = await exchange(completedFrame(), { repetitions: 2 });
      return result({ ...independent.storeFacts, retryFieldPresent: independent.metrics.some((metric) => metric.timeline?.retryClassification !== undefined) }, {
        ...preservation(independent), alternative_response_preserved: retry.responsePreserved,
        transport_count_projections_equal: equalFacts(independent.storeFacts, retry.storeFacts),
        schema_has_no_retry_cause: independent.metrics.every((metric) => metric.timeline === undefined),
      });
    }
    case "C24": {
      const value = await exchange(completedFrame());
      const transport = { status: value.metric.responseStatus ?? null, pipelineCompleted: value.metric.completed ?? false, completionMarkerObserved: value.metric.terminalEventObserved ?? false };
      // Different declared external outcomes cannot affect a proxy that receives neither.
      const passingSidecar = { verifier: true, scope: true };
      const failingSidecar = { verifier: false, scope: false };
      const projectWithoutSidecar = (_sidecar: typeof passingSidecar): Facts => ({ ...transport });
      return result({ ...transport, verifier: "UNAVAILABLE", scope: "UNAVAILABLE", harnessCompletion: "UNAVAILABLE" }, {
        ...preservation(value), task_outcomes_not_in_metric: !("verifier" in value.metric) && !("scope" in value.metric) && !("harnessCompletion" in value.metric),
        distinct_external_outcomes_same_transport: equalFacts(projectWithoutSidecar(passingSidecar), projectWithoutSidecar(failingSidecar)),
      });
    }
    default: throw new Error("unknown_fixture");
  }
}
