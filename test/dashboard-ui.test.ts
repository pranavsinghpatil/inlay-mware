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
  open = false;
  value = "";
  private listeners = new Map<string, (() => void)[]>();
  append(...elements: Element[]) { this.children.push(...elements); }
  addEventListener(type: string, listener: () => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  dispatch(type: string) { for (const listener of this.listeners.get(type) ?? []) listener(); }
  insertBefore(element: Element, reference: Element | null) {
    const old = this.children.indexOf(element);
    if (old >= 0) this.children.splice(old, 1);
    const index = reference ? this.children.indexOf(reference) : this.children.length;
    this.children.splice(index, 0, element);
  }
  removeChild(child: Element) { this.children.splice(this.children.indexOf(child), 1); }
  get firstChild() { return this.children[0] ?? null; }
}

function harness(fetchImpl: (...args: unknown[]) => Promise<unknown>) {
  const elements = new Map<string, Element>();
  const events: { type: string; detail: unknown }[] = [];
  const timers: { callback: () => void; delay: number }[] = [];
  const document = {
    getElementById(id: string) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; },
    createElement(_tag: string) { return new Element(); },
    dispatchEvent(event: { type: string; detail: unknown }) { events.push(event); return true; },
  };
  vm.runInNewContext(constants.DASHBOARD_JS, {
    document,
    CustomEvent: class { type: string; detail: unknown; constructor(type: string, init: { detail: unknown }) { this.type = type; this.detail = init.detail; } },
    fetch: fetchImpl,
    AbortController,
    Intl,
    Date,
    setTimeout(callback: () => void, delay = 0) { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
  });
  const flatten = (element: Element): string => element.textContent + element.children.map(flatten).join(" ");
  return { elements, timers, events, flatten };
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
    recent: [{ route: "/v1/responses", durationMs: 18, requestBytes: 12, responseBytes: null, inputTokens: 12 as number | null, outputTokens: null, cachedInputTokens: 2, canonicalBytes: 20, inputItems: 2, previouslySeenItems: 1, completed: true, cancelled: false, terminalEventObserved: true, responseObservationIncomplete: false, requestStructureUnavailableReason: null, recurrenceIncomplete: false }],
    history: { status: "off", reason: null as string | null, retentionSessions: 20, sessions: [] as object[] }, refreshMs: 2000, checkpointMs: 5000,
  };
}

test("dashboard markup is self-hosted and has accessible status regions", () => {
  assert.match(constants.DASHBOARD_HTML, /aria-live="polite"/);
  assert.match(constants.DASHBOARD_HTML, /id="recent-transport"/);
  assert.match(constants.DASHBOARD_HTML, /id="history-from"/);
  assert.doesNotMatch(constants.DASHBOARD_HTML, /class="activity-summary"/);
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
  assert.match(historyDashboard.elements.get("history-count")!.textContent, /1 of 1 retained summaries/);
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


test("empty outcome context distinguishes no records from admitted handler activity", async () => {
  const data = payload();
  data.current.totals.outcomes = 0;
  data.current.lifecycle.admitted = 0;
  const empty = harness(async () => ({ ok: true, json: async () => data }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(empty.elements.get("activity-title")!.textContent, "No recorded outcomes");
  assert.match(empty.elements.get("activity-description")!.textContent, /Only traffic routed through Inlay/);
  assert.match(empty.elements.get("usage-note")!.textContent, /no recorded outcomes to sum/);
  data.current.lifecycle.admitted = 1;
  const admitted = harness(async () => ({ ok: true, json: async () => data }));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(admitted.elements.get("activity-description")!.textContent, /Handler activity exists/);
  assert.doesNotMatch(admitted.elements.get("activity-description")!.textContent, /no traffic/i);
});

test("missing lifecycle evidence does not assert complete accounting", async () => {
  const data = payload();
  const partial = data.current.lifecycle as Partial<typeof data.current.lifecycle>;
  delete partial.incomplete;
  partial.availability = "UNAVAILABLE";
  const h = harness(async () => ({ ok: true, json: async () => data }));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.flatten(h.elements.get("lifecycle")!), /Accounting incomplete: unavailable/);
  assert.doesNotMatch(h.flatten(h.elements.get("lifecycle")!), /Accounting incomplete: no/);
});

test("polling keeps history disclosure nodes and open state while checkpoints update", async () => {
  const data = payload();
  data.history = { status: "ready", reason: null, retentionSessions: 20, sessions: [data.current] };
  const h = harness(async () => ({ ok: true, json: async () => data }));
  await new Promise(resolve => setImmediate(resolve));
  const history = h.elements.get("history")!;
  const disclosure = history.children[1];
  disclosure.open = true;
  const summary = disclosure.children[0];
  const recentRow = h.elements.get("recent")!.children[0];
  data.current.updatedAt = "2026-01-01T00:02:00.000Z";
  data.current.totals.outcomes = 3;
  h.timers.find(timer => timer.delay === 2000)!.callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(history.children[1], disclosure);
  assert.equal(disclosure.children[0], summary);
  assert.equal(disclosure.open, true);
  assert.match(h.flatten(disclosure), /3 outcomes/);
  assert.equal(h.elements.get("recent")!.children[0], recentRow);
});

test("recent filters stay within retained outcomes and distinguish no matches from no outcomes", async () => {
  const data = payload();
  data.recent.push({ ...data.recent[0], route: "/v1/chat/completions", inputTokens: null, completed: false, cancelled: true, responseObservationIncomplete: true });
  const h = harness(async () => ({ ok: true, json: async () => data }));
  await new Promise(resolve => setImmediate(resolve));
  const route = h.elements.get("recent-route")!;
  route.value = "/v1/chat/completions";
  route.dispatch("change");
  assert.match(h.elements.get("recent-count")!.textContent, /1 of 2 retained outcomes/);
  assert.match(h.flatten(h.elements.get("recent")!), /\/v1\/chat\/completions/);
  assert.doesNotMatch(h.flatten(h.elements.get("recent")!), /\/v1\/responses/);
  const usage = h.elements.get("recent-usage")!;
  usage.value = "available";
  usage.dispatch("change");
  assert.match(h.elements.get("recent-count")!.textContent, /0 of 2 retained outcomes · No matches/);
  assert.match(h.flatten(h.elements.get("recent")!), /No outcomes match these filters/);
  const view = h.events.filter(event => event.type === "inlay:view").at(-1)!.detail as { recent?: unknown[]; selection: Record<string, string> };
  assert.equal(view.recent, undefined);
  assert.equal(view.selection["recent-usage"], undefined);
});

test("history filters use bounded stored summaries, date bounds and order", async () => {
  const data = payload();
  const older = { ...data.current, sessionId: "older", startedAt: "2025-12-01T00:00:00.000Z", state: "closed" };
  const newer = { ...data.current, sessionId: "newer", startedAt: "2026-02-01T00:00:00.000Z", state: "running" };
  data.history = { status: "ready", reason: null, retentionSessions: 20, sessions: [newer, older] };
  const h = harness(async () => ({ ok: true, json: async () => data }));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.elements.get("history-count")!.textContent, /2 of 2 retained summaries/);
  const state = h.elements.get("history-state")!;
  state.value = "closed";
  state.dispatch("change");
  assert.match(h.elements.get("history-count")!.textContent, /1 of 2 retained summaries/);
  assert.match(h.flatten(h.elements.get("history")!), /Closed/);
  assert.doesNotMatch(h.flatten(h.elements.get("history")!), /Running at last checkpoint/);
  state.value = "";
  state.dispatch("change");
  const order = h.elements.get("history-order")!;
  order.value = "oldest";
  order.dispatch("change");
  const firstSession = h.elements.get("history")!.children[1];
  assert.match(h.flatten(firstSession), /12\/1\/2025/);
  const from = h.elements.get("history-from")!;
  from.value = "2026-01-01";
  from.dispatch("change");
  assert.match(h.elements.get("history-count")!.textContent, /1 of 2 retained summaries/);
  const to = h.elements.get("history-to")!;
  to.value = "2025-12-01";
  to.dispatch("change");
  assert.match(h.elements.get("history-count")!.textContent, /0 of 2 retained summaries · Start-date range is reversed/);
});


test("history filters include older retained summaries beyond the recent twenty and route choice survives eviction", async () => {
  const data = payload();
  data.history = { status: "ready", reason: null, retentionSessions: 30, sessions: Array.from({ length: 25 }, (_, index) => ({ ...data.current, sessionId: "saved-" + index, state: index === 24 ? "closed" : "running" })) };
  const h = harness(async () => ({ ok: true, json: async () => data }));
  await new Promise(resolve => setImmediate(resolve));
  const state = h.elements.get("history-state")!;
  state.value = "closed"; state.dispatch("change");
  assert.match(h.elements.get("history-count")!.textContent, /1 of 25 retained summaries/);
  assert.equal(h.elements.get("history-filters")!.hidden, false);
  const route = h.elements.get("recent-route")!;
  route.value = "/v1/responses"; route.dispatch("change");
  data.recent = [];
  h.timers.find(timer => timer.delay === 2000)!.callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(route.value, "/v1/responses");
});
