import assert from "node:assert/strict";
import test from "node:test";
import {
  ObservationAccumulator,
  isObservationTotals,
  projectRecent,
  projectRecurrence,
  type ObservationTotals,
} from "../src/local-observation.ts";
import type { RequestMetric } from "../src/metrics.ts";

function metric(overrides: Partial<RequestMetric> = {}): RequestMetric {
  return {
    requestId: "private-request-id",
    route: "/v1/responses",
    startedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 3,
    requestBytes: 12,
    ...overrides,
  };
}

test("aggregate covers the process lifetime beyond the recent ring size", () => {
  const accumulator = new ObservationAccumulator();
  for (let i = 0; i < 135; i++) accumulator.record(metric({ requestBytes: i, responseBytes: 2 }));
  const totals = accumulator.snapshot();
  assert.equal(totals.outcomes, 135);
  assert.deepEqual(totals.requestBytes, { sum: 9045, available: 135, missing: 0 });
  assert.deepEqual(totals.responseBytes, { sum: 270, available: 135, missing: 0 });
  assert.equal(isObservationTotals(totals), true);
});

test("keeps absent measurements missing and explicit zero usage available", () => {
  const accumulator = new ObservationAccumulator();
  accumulator.record(metric({ usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 } }));
  accumulator.record(metric());
  const totals = accumulator.snapshot();
  assert.deepEqual(totals.usage.inputTokens, { sum: 0, available: 1, missing: 1 });
  assert.deepEqual(totals.responseBytes, { sum: null, available: 0, missing: 2 });
  assert.deepEqual(totals.transport.completed, { yes: 0, no: 0, unavailable: 2 });
  assert.deepEqual(totals.structure.canonicalBytes, { sum: null, available: 0, missing: 2 });
  assert.equal(isObservationTotals(totals), true);
});

test("makes overflowing sums unavailable without saturating or retaining false precision", () => {
  const accumulator = new ObservationAccumulator();
  accumulator.record(metric({ requestBytes: Number.MAX_VALUE }));
  accumulator.record(metric({ requestBytes: Number.MAX_VALUE }));
  const value = accumulator.snapshot();
  assert.deepEqual(value.requestBytes, { sum: null, available: 2, missing: 0 });
  assert.equal(isObservationTotals(value), true);
});

test("throws on unsafe category counters without partially changing the aggregate", () => {
  const accumulator = new ObservationAccumulator();
  accumulator.record(metric({ requestStructure: {
    canonicalStructuralBytesTotal: 1,
    topLevelFieldCount: 1,
    topLevelFields: [],
    inputItemTypeCounts: { message: Number.MAX_SAFE_INTEGER },
    inputItemTypeCanonicalJsonBytes: { message: 1 },
  } }));
  const before = accumulator.snapshot();
  assert.throws(() => accumulator.record(metric({ requestStructure: {
    canonicalStructuralBytesTotal: 1,
    topLevelFieldCount: 1,
    topLevelFields: [],
    inputItemTypeCounts: { message: 1 },
    inputItemTypeCanonicalJsonBytes: { message: 1 },
  } })), RangeError);
  assert.deepEqual(accumulator.snapshot(), before);
});

test("recent projection drops identifiers, timestamps, raw content, unknown fields and unknown categories", () => {
  const poisoned = metric({
    requestId: "SENTINEL_RAW_ID",
    route: "https://secret.invalid/path" as RequestMetric["route"],
    startedAt: "SENTINEL_TIMESTAMP",
    requestStructure: {
      canonicalStructuralBytesTotal: 9,
      topLevelFieldCount: 1,
      topLevelFields: [{ name: "SENTINEL_KEY", count: 1, canonicalJsonBytes: 3 }],
      inputItemCount: 1,
      inputItemTypeCounts: { "SENTINEL_TYPE": 1 },
      inputItemTypeCanonicalJsonBytes: { "SENTINEL_TYPE": 5 },
      secret: "SENTINEL_NESTED",
    } as unknown as RequestMetric["requestStructure"],
    secret: "SENTINEL_TOP_LEVEL",
  } as Partial<RequestMetric>);
  const recent = projectRecent(poisoned as RequestMetric);
  assert.deepEqual(Object.keys(recent).sort(), [
    "route", "durationMs", "requestBytes", "responseBytes", "inputTokens", "outputTokens", "cachedInputTokens",
    "canonicalBytes", "inputItems", "previouslySeenItems", "completed", "cancelled", "terminalEventObserved",
    "responseObservationIncomplete", "requestStructureUnavailableReason", "recurrenceIncomplete",
  ].sort());
  assert.equal(recent.route, "other");
  assert.equal(JSON.stringify(recent).includes("SENTINEL"), false);

  const accumulator = new ObservationAccumulator();
  accumulator.record(poisoned as RequestMetric);
  const totals = accumulator.snapshot();
  assert.equal(totals.structure.itemTypes.other.count, 1);
  assert.equal(totals.structure.itemTypes.other.canonicalBytes, 5);
  assert.equal(JSON.stringify(totals).includes("SENTINEL"), false);
  assert.equal(Object.keys(totals.structure.itemTypes).length, 8);
});

test("projects only recurrence totals and returns null while recurrence tracking is off", () => {
  assert.equal(projectRecurrence(undefined), null);
  assert.deepEqual(projectRecurrence({
    recurringGroupCount: 2,
    groups: [{ itemType: "secret", canonicalJsonBytes: 15 } as never],
    groupsTruncated: true,
    comparisonIncomplete: false,
  }), { recurringGroupCount: 2, groupsTruncated: true, comparisonIncomplete: false });
});

test("strict persisted totals validator rejects extra keys, arbitrary categories and invalid numbers", () => {
  const totals = new ObservationAccumulator().snapshot();
  assert.equal(isObservationTotals(totals), true);
  assert.equal(isObservationTotals({ ...totals, privatePayload: "SENTINEL" }), false);

  const extraCategory = structuredClone(totals) as unknown as { structure: { itemTypes: Record<string, unknown> } };
  extraCategory.structure.itemTypes.secret = { count: 1, canonicalBytes: 1 };
  assert.equal(isObservationTotals(extraCategory), false);

  const badNumber = structuredClone(totals);
  badNumber.requestBytes.sum = Number.POSITIVE_INFINITY;
  assert.equal(isObservationTotals(badNumber), false);

  const fractionalCount = structuredClone(totals);
  fractionalCount.structure.itemTypes.message.count = 0.5;
  assert.equal(isObservationTotals(fractionalCount), false);

  const inconsistent = new ObservationAccumulator();
  inconsistent.record(metric());
  const contradictory = inconsistent.snapshot();
  contradictory.responseBytes.available += 1;
  assert.equal(isObservationTotals(contradictory), false);
  contradictory.responseBytes.available -= 1;
  contradictory.transport.completed.yes += 1;
  assert.equal(isObservationTotals(contradictory), false);
  contradictory.transport.completed.yes -= 1;
  contradictory.structure.available += 1;
  assert.equal(isObservationTotals(contradictory), false);
  contradictory.structure.available -= 1;
  contradictory.recurrence.available += 1;
  assert.equal(isObservationTotals(contradictory), false);
  contradictory.recurrence.available -= 1;
  contradictory.structure.reasons.not_json = 1;
  contradictory.structure.reasons.content_encoded = 1;
  assert.equal(isObservationTotals(contradictory), false);
});
