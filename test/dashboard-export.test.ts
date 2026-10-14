import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { DASHBOARD_EXPORT_JS } from "../src/dashboard-export.ts";

function harness() {
  const events = new Map<string, (event: { detail: unknown }) => void>();
  const controls = new Map<string, { disabled: boolean; textContent: string; click?: () => void }>();
  const blobs: Blob[] = [];
  const links: { href?: string; download?: string; click(): void; remove(): void }[] = [];
  const document = {
    addEventListener(name: string, fn: (event: { detail: unknown }) => void) { events.set(name, fn); },
    getElementById(name: string) {
      if (!controls.has(name)) controls.set(name, { disabled: true, textContent: name === "connection" ? "Live" : "" });
      const control = controls.get(name)!;
      return Object.assign(control, { addEventListener(_name: string, fn: () => void) { control.click = fn; } });
    },
    createElement() { const link = { click() {}, remove() {} }; links.push(link); return link; },
    body: { append() {} },
  };
  vm.runInNewContext(DASHBOARD_EXPORT_JS, { document, Blob, Date, URL: { createObjectURL(blob: Blob) { blobs.push(blob); return "blob:synthetic"; }, revokeObjectURL() {} }, setTimeout() {} });
  document.getElementById("connection");
  return { controls, blobs, links, update(detail: unknown) { events.get("inlay:view")!({ detail }); }, click(format: string) { controls.get("export-" + format)!.click!(); } };
}
function fixture() {
  const current = {
    sessionId: "opaque-local-id", startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:01:00.000Z", endedAt: null, state: "running",
    totals: { outcomes: 1, usage: { inputTokens: { sum: 0, available: 1, missing: 0 }, outputTokens: { sum: null, available: 0, missing: 1 } } },
    lifecycle: { admitted: 1, active: 0, forwarding: 1, finalized: 1, availability: "AVAILABLE", incomplete: false, unavailableReason: null },
  };
  return { current, modes: { observation: "structural", recurrence: "off" }, recent: [{ requestId: "forbidden-recent-id", route: "/v1/responses" }], history: { status: "ready", reason: null, retentionSessions: 20, sessions: [current, { ...current, sessionId: "saved-id", state: "closed", endedAt: "2026-01-01T00:02:00.000Z" }] }, selection: { "history-state": "", "history-order": "newest" } };
}

test("JSON export allowlists aggregate fields and excludes identifiers, recent rows and extra strings", async () => {
  const h = harness();
  const data = fixture();
  const marker = "forbidden-export-marker";
  Object.assign(data.current, { prompt: marker, headers: { Authorization: marker }, upstreamUrl: marker });
  Object.assign(data.current.totals, { toolOutput: marker });
  data.current.lifecycle.unavailableReason = marker as never;
  h.update(data);
  assert.equal(h.controls.get("export-json")!.disabled, false);
  h.click("json");
  const text = await h.blobs[0].text();
  assert.doesNotMatch(text, /forbidden|opaque-local-id|saved-id|requestId|sessionId|Authorization|upstreamUrl/);
  const exported = JSON.parse(text);
  assert.equal(exported.summaries.length, 2); // current checkpoint is not duplicated
  assert.equal(exported.summaries[0].totals.usage.inputTokens.sum, 0);
  assert.equal(exported.summaries[0].totals.usage.outputTokens.sum, null);
  assert.equal(exported.summaries[0].lifecycle.unavailableReason, null);
  assert.equal(exported.dashboardConnection, "live");
});

test("CSV export retains reported zero, missing coverage and unknown cells without formula strings", async () => {
  const h = harness();
  const data = fixture();
  data.current.state = "=malicious";
  h.update(data); h.click("csv");
  const csv = await h.blobs[0].text();
  assert.equal(csv.split("\r\n").filter(Boolean).length, 3);
  assert.match(csv, /"inputTokens_sum","inputTokens_available","inputTokens_missing"/);
  assert.match(csv, /"0","1","0",,"0","1"/);
  assert.doesNotMatch(csv, /=malicious|requestId|sessionId|forbidden-recent-id/);
  assert.match(csv, /structure_canonicalBytes_sum/);
  assert.match(csv, /recurrence_previouslySeenItems_missing/);
  assert.match(csv, /selected_started_from_utc/);
  assert.match(csv, /history_status/);
});

test("export before a valid snapshot produces no download", () => {
  const h = harness(); h.click("json");
  assert.equal(h.blobs.length, 0);
  assert.match(h.controls.get("export-status")!.textContent, /No valid aggregate snapshot/);
});

test("offline export explicitly labels the last received aggregate snapshot as stale", async () => {
  const h = harness(); h.update(fixture());
  h.controls.get("connection")!.textContent = "Offline";
  h.click("json");
  assert.equal(JSON.parse(await h.blobs[0].text()).dashboardConnection, "stale");
  assert.match(h.controls.get("export-status")!.textContent, /connection is offline/);
});
