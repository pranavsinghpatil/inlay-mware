import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { DASHBOARD_HTML, DASHBOARD_CSS, DASHBOARD_JS } from "../src/dashboard.ts";

const constants = { DASHBOARD_HTML, DASHBOARD_CSS, DASHBOARD_JS };

class Element {
  children: Element[] = [];
  className = "";
  textContent = "";
  hidden = false;
  colSpan = 1;
  append(...elements: Element[]) { this.children.push(...elements); }
  removeChild(child: Element) { this.children.splice(this.children.indexOf(child), 1); }
  get firstChild() { return this.children[0] ?? null; }
}

function harness(fetchImpl: (...args: unknown[]) => Promise<unknown>) {
  const elements = new Map<string, Element>();
  const timers: { callback: () => void; delay: number }[] = [];
  const document = {
    getElementById(id: string) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; },
    createElement(_tag: string) { return new Element(); },
  };
  vm.runInNewContext(constants.DASHBOARD_JS, {
    document,
    fetch: fetchImpl,
    AbortController,
    Intl,
    Date,
    setTimeout(callback: () => void, delay = 0) { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
  });
  const flatten = (element: Element): string => element.textContent + element.children.map(flatten).join(" ");
  return { elements, timers, flatten };
}

function payload() {
  const coverage = (sum: number | null, available: number, missing: number) => ({ sum, available, missing });
  return {
    version: 1,
    modes: { observation: "structural", recurrence: "exact-item" },
    current: {
      sessionId: "aggregate-id", startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:01:00.000Z", endedAt: null, state: "running",
      totals: {
        outcomes: 2, requestBytes: coverage(30, 2, 0), responseBytes: coverage(25, 1, 1),
        usage: { inputTokens: coverage(12, 1, 1), outputTokens: coverage(4, 1, 1), totalTokens: coverage(null, 0, 2), cachedInputTokens: coverage(2, 1, 1) },
        transport: Object.fromEntries(["completed", "cancelled", "terminalEventObserved", "responseObservationIncomplete", "cancelledAfterTerminalEvent"].map(k => [k, { yes: 1, no: 0, unavailable: 1 }])),
        structure: { available: 1, unavailable: 1, reasons: { content_encoded: 1, not_json: 0, zstd_decode_failed: 0, zstd_output_limit: 0 }, canonicalBytes: coverage(20, 1, 1), inputItems: coverage(2, 1, 1), itemTypes: { message: { count: 2, canonicalBytes: 20 } } },
        recurrence: { available: 1, unavailable: 1, comparedItems: coverage(2, 1, 1), previouslySeenItems: coverage(1, 1, 1), previouslySeenBytes: coverage(8, 1, 1), incomplete: { yes: 0, no: 1, unavailable: 1 } },
      }, lifecycle: { admitted: 2, active: 1, forwarding: 1, finalized: 1, availability: "AVAILABLE", incomplete: false, unavailableReason: null },
      recurrence: { recurringGroupCount: 3, groupsTruncated: false, comparisonIncomplete: false },
    },
    recent: [{ route: "/v1/responses", durationMs: 18, requestBytes: 12, responseBytes: null, inputTokens: 12, outputTokens: null, cachedInputTokens: 2, canonicalBytes: 20, inputItems: 2, previouslySeenItems: 1, completed: true, cancelled: false, terminalEventObserved: true, responseObservationIncomplete: false, requestStructureUnavailableReason: null, recurrenceIncomplete: false }],
    history: { status: "off", reason: null as string | null, retentionSessions: 20, sessions: [] as object[] }, refreshMs: 2000, checkpointMs: 5000,
  };
}

test("dashboard markup is self-hosted and has accessible status regions", () => {
  assert.match(constants.DASHBOARD_HTML, /aria-live="polite"/);
  assert.match(constants.DASHBOARD_HTML, /\/dashboard\/style\.css/);
  assert.match(constants.DASHBOARD_HTML, /\/dashboard\/app\.js/);
  assert.doesNotMatch(constants.DASHBOARD_HTML, /https?:\/\//);
  assert.doesNotMatch(constants.DASHBOARD_CSS, /@import|url\(/);
});

test("renders coverage, approved summaries and missing values without inventing zeroes", async () => {
  const h = harness(async () => ({ ok: true, json: async () => payload() }));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.flatten(h.elements.get("usage")!), /12/);
  assert.match(h.flatten(h.elements.get("usage")!), /1 available · 1 missing/);
  assert.match(h.flatten(h.elements.get("usage")!), /Unavailable/);
  assert.match(h.flatten(h.elements.get("lifecycle")!), /2/);
  assert.match(h.flatten(h.elements.get("lifecycle")!), /Accounting incomplete: no/);
  assert.match(h.flatten(h.elements.get("lifecycle")!), /Observation mode/);
  assert.match(h.flatten(h.elements.get("lifecycle")!), /Session started/);
  assert.match(h.flatten(h.elements.get("recent")!), /\/v1\/responses/);
  assert.match(h.flatten(h.elements.get("history")!), /History is off/);
  assert.match(h.flatten(h.elements.get("history")!), /INLAY_HISTORY_DIR/);
  assert.match(h.flatten(h.elements.get("recurrence")!), /Tracker groups not truncated/);
  assert.match(h.flatten(h.elements.get("recent")!), /Known response incompleteness: no/);
  assert.match(h.flatten(h.elements.get("recent")!), /Known recurrence incompleteness: no/);
  assert.doesNotMatch(h.flatten(h.elements.get("recent")!), /aggregate-id/);
  assert.equal(h.elements.get("connection")!.textContent, "Live");
  const data = payload();
  data.history = { status: "ready", reason: null, retentionSessions: 12, sessions: [{ ...data.current, endedAt: "2026-01-01T00:02:00.000Z" }] };
  const historyDashboard = harness(async () => ({ ok: true, json: async () => data }));
  await new Promise(resolve => setImmediate(resolve));
  const history = historyDashboard.flatten(historyDashboard.elements.get("history")!);
  assert.match(history, /Showing 1 of 1 retained summaries/);
  assert.match(history, /12 sessions/);
  assert.match(history, /1 available · 1 missing/);
  assert.match(history, /Known response incomplete/);
  assert.match(history, /Recurrence incomplete/);
  assert.match(history, /Transport completed/);
  assert.match(history, /Admitted/);
  assert.match(history, /Finalized/);
});

test("poll waits for completion, schedules one follow-up and preserves last view as offline", async () => {
  let resolveFetch!: (value: unknown) => void;
  let calls = 0;
  const h = harness(() => { calls += 1; if (calls > 1) return Promise.reject(new Error("offline")); return new Promise(resolve => { resolveFetch = resolve; }); });
  assert.equal(calls, 1);
  assert.deepEqual(h.timers.map(timer => timer.delay), [5000]); // only request timeout while pending
  resolveFetch({ ok: true, json: async () => payload() });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.timers.map(timer => timer.delay), [5000, 2000]);
  assert.match(h.flatten(h.elements.get("recent")!), /\/v1\/responses/);
  h.timers[1].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.elements.get("connection")!.textContent, "Offline");
  assert.match(h.elements.get("notice")!.textContent, /last successful update/);
  assert.match(h.flatten(h.elements.get("recent")!), /\/v1\/responses/);
});

test("initial offline state is explicit and never renders placeholder zeroes", async () => {
  const h = harness(async () => { throw new Error("offline"); });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.elements.get("connection")!.textContent, "Offline");
  assert.match(h.elements.get("notice")!.textContent, /No values have been assumed/);
  assert.equal(h.elements.has("recent"), false);
});

test("historical usage keeps coverage and incomplete flags separate from successful transport flags", async () => {
  const data = payload();
  data.current.totals.transport.completed = { yes: 2, no: 0, unavailable: 0 };
  data.current.totals.transport.responseObservationIncomplete = { yes: 0, no: 1, unavailable: 1 };
  data.history = { status: "ready", reason: null, retentionSessions: 12, sessions: [data.current] };
  const h = harness(async () => ({ ok: true, json: async () => data }));
  await new Promise(resolve => setImmediate(resolve));
  const history = h.flatten(h.elements.get("history")!);
  assert.match(history, /1 available · 1 missing/);
  assert.match(history, /0 yes · 1 no · 1 unavailable/);
  assert.match(history, /2 yes · 0 no · 0 unavailable/);
  assert.match(history, /12 sessions/);
  assert.doesNotMatch(history, /known positive transport flags/);
});
