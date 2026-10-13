import type { ExactItemRecurrenceSummary, RequestStructureUnavailableReason } from "./observation.ts";
import type { RequestMetric } from "./metrics.ts";

export interface NumericCoverage {
  sum: number | null;
  available: number;
  missing: number;
}

export interface FlagCounts {
  yes: number;
  no: number;
  unavailable: number;
}

export type InputItemCategory =
  | "computer_call"
  | "computer_call_output"
  | "function_call"
  | "function_call_output"
  | "item_reference"
  | "message"
  | "reasoning"
  | "other";

export type StructureReason = RequestStructureUnavailableReason;
export type TransportFlag = "completed" | "cancelled" | "terminalEventObserved" | "responseObservationIncomplete" | "cancelledAfterTerminalEvent";
export type UsageField = "inputTokens" | "outputTokens" | "totalTokens" | "cachedInputTokens";

export interface ObservationTotals {
  outcomes: number;
  requestBytes: NumericCoverage;
  responseBytes: NumericCoverage;
  usage: Record<UsageField, NumericCoverage>;
  transport: Record<TransportFlag, FlagCounts>;
  structure: {
    available: number;
    unavailable: number;
    reasons: Record<StructureReason, number>;
    canonicalBytes: NumericCoverage;
    inputItems: NumericCoverage;
    itemTypes: Record<InputItemCategory, { count: number; canonicalBytes: number | null }>;
  };
  recurrence: {
    available: number;
    unavailable: number;
    comparedItems: NumericCoverage;
    previouslySeenItems: NumericCoverage;
    previouslySeenBytes: NumericCoverage;
    incomplete: FlagCounts;
  };
}

export interface ApprovedRecent {
  route: "/v1/chat/completions" | "/v1/responses" | "/v1/codex/responses" | "other";
  durationMs: number | null;
  requestBytes: number | null;
  responseBytes: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  canonicalBytes: number | null;
  inputItems: number | null;
  previouslySeenItems: number | null;
  completed: boolean | null;
  cancelled: boolean | null;
  terminalEventObserved: boolean | null;
  responseObservationIncomplete: boolean | null;
  requestStructureUnavailableReason: StructureReason | null;
  recurrenceIncomplete: boolean | null;
}

export interface RecurrenceSummary {
  recurringGroupCount: number | null;
  groupsTruncated: boolean | null;
  comparisonIncomplete: boolean | null;
}

const STRUCTURE_REASONS = ["content_encoded", "not_json", "zstd_decode_failed", "zstd_output_limit"] as const;
const INPUT_CATEGORIES: readonly InputItemCategory[] = [
  "computer_call", "computer_call_output", "function_call", "function_call_output",
  "item_reference", "message", "reasoning", "other",
];
const USAGE_FIELDS: readonly UsageField[] = ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens"];
const TRANSPORT_FLAGS: readonly TransportFlag[] = [
  "completed", "cancelled", "terminalEventObserved", "responseObservationIncomplete", "cancelledAfterTerminalEvent",
];
const ROUTES = ["/v1/chat/completions", "/v1/responses", "/v1/codex/responses"] as const;
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const validNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const validCount = (value: unknown): value is number => Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.length && keys.every((key) => hasOwn(value, key));
};
function incrementCounter(target: object, key: string, amount = 1): void {
  const record = target as Record<string, unknown>;
  const current = record[key];
  if (!validCount(current) || !validCount(amount)) throw new RangeError(`Invalid observation counter: ${key}`);
  const next = current + amount;
  if (!Number.isSafeInteger(next) || next < current) throw new RangeError(`Observation counter overflow: ${key}`);
  record[key] = next;
}
function incrementCoverage(target: NumericCoverage, field: "available" | "missing"): void {
  incrementCounter(target, field);
}

function coverage(): NumericCoverage { return { sum: null, available: 0, missing: 0 }; }
function flags(): FlagCounts { return { yes: 0, no: 0, unavailable: 0 }; }
function freshTotals(): ObservationTotals {
  const usage = Object.fromEntries(USAGE_FIELDS.map((field) => [field, coverage()])) as Record<UsageField, NumericCoverage>;
  const transport = Object.fromEntries(TRANSPORT_FLAGS.map((field) => [field, flags()])) as Record<TransportFlag, FlagCounts>;
  const reasons = Object.fromEntries(STRUCTURE_REASONS.map((reason) => [reason, 0])) as Record<StructureReason, number>;
  const itemTypes = Object.fromEntries(INPUT_CATEGORIES.map((category) => [category, { count: 0, canonicalBytes: 0 }])) as ObservationTotals["structure"]["itemTypes"];
  return {
    outcomes: 0,
    requestBytes: coverage(),
    responseBytes: coverage(),
    usage,
    transport,
    structure: { available: 0, unavailable: 0, reasons, canonicalBytes: coverage(), inputItems: coverage(), itemTypes },
    recurrence: { available: 0, unavailable: 0, comparedItems: coverage(), previouslySeenItems: coverage(), previouslySeenBytes: coverage(), incomplete: flags() },
  };
}

function addNumeric(target: NumericCoverage, value: unknown): void {
  if (!validNumber(value)) { incrementCoverage(target, "missing"); return; }
  const priorAvailable = target.available;
  incrementCoverage(target, "available");
  if (target.sum === null && priorAvailable === 0) target.sum = value;
  else if (target.sum !== null) {
    const next = target.sum + value;
    target.sum = Number.isFinite(next) ? next : null;
  }
}

function addCounts(target: FlagCounts, value: unknown): void {
  if (typeof value !== "boolean") { incrementCounter(target, "unavailable"); return; }
  if (value) incrementCounter(target, "yes");
  else incrementCounter(target, "no");
}

function categoryFor(value: string): InputItemCategory {
  return (INPUT_CATEGORIES as readonly string[]).includes(value) && value !== "other" ? value as InputItemCategory : "other";
}

function fixedReason(value: unknown): StructureReason | undefined {
  return typeof value === "string" && (STRUCTURE_REASONS as readonly string[]).includes(value)
    ? value as StructureReason : undefined;
}

function addStructure(totals: ObservationTotals, metric: RequestMetric): void {
  const structure = metric.requestStructure;
  if (!isRecord(structure)) {
    incrementCounter(totals.structure, "unavailable");
    const reason = fixedReason(metric.requestStructureUnavailableReason);
    if (reason) incrementCounter(totals.structure.reasons, reason);
    addNumeric(totals.structure.canonicalBytes, undefined);
    addNumeric(totals.structure.inputItems, undefined);
    return;
  }
  incrementCounter(totals.structure, "available");
  addNumeric(totals.structure.canonicalBytes, structure.canonicalStructuralBytesTotal);
  addNumeric(totals.structure.inputItems, structure.inputItemCount);
  const rawCounts = isRecord(structure.inputItemTypeCounts) ? structure.inputItemTypeCounts : {};
  const rawBytes = isRecord(structure.inputItemTypeCanonicalJsonBytes) ? structure.inputItemTypeCanonicalJsonBytes : {};
  for (const sourceType of new Set([...Object.keys(rawCounts), ...Object.keys(rawBytes)])) {
    const category = categoryFor(sourceType);
    const itemType = totals.structure.itemTypes[category];
    const count = rawCounts[sourceType];
    const bytes = rawBytes[sourceType];
    if (validCount(count)) {
      incrementCounter(itemType, "count", count);
    }
    if (validNumber(bytes) && itemType.canonicalBytes !== null) {
      const next = itemType.canonicalBytes + bytes;
      itemType.canonicalBytes = Number.isFinite(next) ? next : null;
    } else if (bytes !== undefined) {
      itemType.canonicalBytes = null;
    }
  }
}

function addRecurrence(totals: ObservationTotals, metric: RequestMetric): void {
  const recurrence = metric.exactItemRecurrence;
  if (!isRecord(recurrence)) {
    incrementCounter(totals.recurrence, "unavailable");
    addNumeric(totals.recurrence.comparedItems, undefined);
    addNumeric(totals.recurrence.previouslySeenItems, undefined);
    addNumeric(totals.recurrence.previouslySeenBytes, undefined);
    addCounts(totals.recurrence.incomplete, undefined);
    return;
  }
  incrementCounter(totals.recurrence, "available");
  addNumeric(totals.recurrence.comparedItems, recurrence.comparedItemCount);
  addNumeric(totals.recurrence.previouslySeenItems, recurrence.previouslySeenItemCount);
  addNumeric(totals.recurrence.previouslySeenBytes, recurrence.previouslySeenCanonicalJsonBytes);
  addCounts(totals.recurrence.incomplete, recurrence.comparisonIncomplete);
}

/** Holds only fixed aggregates; each recorded outcome contributes once for this process lifetime. */
export class ObservationAccumulator {
  #totals = freshTotals();

  record(metric: RequestMetric): void {
    const next = structuredClone(this.#totals);
    incrementCounter(next, "outcomes");
    addNumeric(next.requestBytes, metric.requestBytes);
    addNumeric(next.responseBytes, metric.responseBytes);
    for (const field of USAGE_FIELDS) addNumeric(next.usage[field], metric.usage?.[field]);
    for (const field of TRANSPORT_FLAGS) addCounts(next.transport[field], metric[field]);
    addStructure(next, metric);
    addRecurrence(next, metric);
    this.#totals = next;
  }

  snapshot(): ObservationTotals {
    return structuredClone(this.#totals);
  }
}

/** Projects one in-memory request metric through a fixed, content-free allowlist. */
export function projectRecent(metric: RequestMetric): ApprovedRecent {
  const rawRoute: unknown = metric.route;
  const route = (ROUTES as readonly unknown[]).includes(rawRoute) ? rawRoute as ApprovedRecent["route"] : "other";
  const structure = isRecord(metric.requestStructure) ? metric.requestStructure : undefined;
  const recurrence = isRecord(metric.exactItemRecurrence) ? metric.exactItemRecurrence : undefined;
  return {
    route,
    durationMs: validNumber(metric.durationMs) ? metric.durationMs : null,
    requestBytes: validNumber(metric.requestBytes) ? metric.requestBytes : null,
    responseBytes: validNumber(metric.responseBytes) ? metric.responseBytes : null,
    inputTokens: validNumber(metric.usage?.inputTokens) ? metric.usage.inputTokens : null,
    outputTokens: validNumber(metric.usage?.outputTokens) ? metric.usage.outputTokens : null,
    cachedInputTokens: validNumber(metric.usage?.cachedInputTokens) ? metric.usage.cachedInputTokens : null,
    canonicalBytes: validNumber(structure?.canonicalStructuralBytesTotal) ? structure.canonicalStructuralBytesTotal : null,
    inputItems: validNumber(structure?.inputItemCount) ? structure.inputItemCount : null,
    previouslySeenItems: validNumber(recurrence?.previouslySeenItemCount) ? recurrence.previouslySeenItemCount : null,
    completed: typeof metric.completed === "boolean" ? metric.completed : null,
    cancelled: typeof metric.cancelled === "boolean" ? metric.cancelled : null,
    terminalEventObserved: typeof metric.terminalEventObserved === "boolean" ? metric.terminalEventObserved : null,
    responseObservationIncomplete: typeof metric.responseObservationIncomplete === "boolean" ? metric.responseObservationIncomplete : null,
    requestStructureUnavailableReason: fixedReason(metric.requestStructureUnavailableReason) ?? null,
    recurrenceIncomplete: typeof recurrence?.comparisonIncomplete === "boolean" ? recurrence.comparisonIncomplete : null,
  };
}

/** Returns only recurrence totals; an absent tracker produces no summary. */
export function projectRecurrence(summary: ExactItemRecurrenceSummary | undefined): RecurrenceSummary | null {
  if (summary === undefined) return null;
  return {
    recurringGroupCount: validCount(summary.recurringGroupCount) ? summary.recurringGroupCount : null,
    groupsTruncated: typeof summary.groupsTruncated === "boolean" ? summary.groupsTruncated : null,
    comparisonIncomplete: typeof summary.comparisonIncomplete === "boolean" ? summary.comparisonIncomplete : null,
  };
}

function validCoverage(value: unknown): value is NumericCoverage {
  if (!isRecord(value) || !exactKeys(value, ["sum", "available", "missing"])) return false;
  if (!validCount(value.available) || !validCount(value.missing)) return false;
  if (value.sum !== null && !validNumber(value.sum)) return false;
  return value.available > 0 || value.sum === null;
}

function safeCountSum(left: number, right: number): number | null {
  const sum = left + right;
  return Number.isSafeInteger(sum) ? sum : null;
}

function coverageMatchesOutcomes(value: NumericCoverage, outcomes: number): boolean {
  return safeCountSum(value.available, value.missing) === outcomes;
}

function flagsMatchOutcomes(value: FlagCounts, outcomes: number): boolean {
  const yesNo = safeCountSum(value.yes, value.no);
  return yesNo !== null && safeCountSum(yesNo, value.unavailable) === outcomes;
}

function validFlags(value: unknown): value is FlagCounts {
  return isRecord(value) && exactKeys(value, ["yes", "no", "unavailable"])
    && validCount(value.yes) && validCount(value.no) && validCount(value.unavailable);
}

/** Strict persisted-data guard: exact keys, closed categories and finite nonnegative values only. */
export function isObservationTotals(value: unknown): value is ObservationTotals {
  if (!isRecord(value) || !exactKeys(value, ["outcomes", "requestBytes", "responseBytes", "usage", "transport", "structure", "recurrence"])) return false;
  if (!validCount(value.outcomes) || !validCoverage(value.requestBytes) || !validCoverage(value.responseBytes)) return false;
  if (!coverageMatchesOutcomes(value.requestBytes, value.outcomes) || !coverageMatchesOutcomes(value.responseBytes, value.outcomes)) return false;
  if (!isRecord(value.usage) || !exactKeys(value.usage, USAGE_FIELDS)) return false;
  const usage = value.usage;
  for (const field of USAGE_FIELDS) {
    const fieldCoverage = usage[field];
    if (!validCoverage(fieldCoverage) || !coverageMatchesOutcomes(fieldCoverage, value.outcomes)) return false;
  }
  if (!isRecord(value.transport) || !exactKeys(value.transport, TRANSPORT_FLAGS)) return false;
  const transport = value.transport;
  for (const field of TRANSPORT_FLAGS) {
    const fieldFlags = transport[field];
    if (!validFlags(fieldFlags) || !flagsMatchOutcomes(fieldFlags, value.outcomes)) return false;
  }

  const structure = value.structure;
  if (!isRecord(structure) || !exactKeys(structure, ["available", "unavailable", "reasons", "canonicalBytes", "inputItems", "itemTypes"])) return false;
  if (!validCount(structure.available) || !validCount(structure.unavailable)
    || !validCoverage(structure.canonicalBytes) || !validCoverage(structure.inputItems)) return false;
  if (safeCountSum(structure.available, structure.unavailable) !== value.outcomes
    || !coverageMatchesOutcomes(structure.canonicalBytes, value.outcomes)
    || !coverageMatchesOutcomes(structure.inputItems, value.outcomes)) return false;
  if (!isRecord(structure.reasons) || !exactKeys(structure.reasons, STRUCTURE_REASONS)) return false;
  const reasons = structure.reasons;
  if (!STRUCTURE_REASONS.every((reason) => validCount(reasons[reason]))) return false;
  let reasonCount = 0;
  for (const reason of STRUCTURE_REASONS) {
    const reasonValue = reasons[reason];
    if (!validCount(reasonValue)) return false;
    const next = safeCountSum(reasonCount, reasonValue);
    if (next === null || next > structure.unavailable) return false;
    reasonCount = next;
  }
  if (!isRecord(structure.itemTypes) || !exactKeys(structure.itemTypes, INPUT_CATEGORIES)) return false;
  for (const category of INPUT_CATEGORIES) {
    const item = structure.itemTypes[category];
    if (!isRecord(item) || !exactKeys(item, ["count", "canonicalBytes"]) || !validCount(item.count)) return false;
    if (item.canonicalBytes !== null && !validNumber(item.canonicalBytes)) return false;
  }

  const recurrence = value.recurrence;
  return isRecord(recurrence) && exactKeys(recurrence, ["available", "unavailable", "comparedItems", "previouslySeenItems", "previouslySeenBytes", "incomplete"])
    && validCount(recurrence.available) && validCount(recurrence.unavailable)
    && safeCountSum(recurrence.available, recurrence.unavailable) === value.outcomes
    && validCoverage(recurrence.comparedItems) && validCoverage(recurrence.previouslySeenItems)
    && validCoverage(recurrence.previouslySeenBytes)
    && coverageMatchesOutcomes(recurrence.comparedItems, value.outcomes)
    && coverageMatchesOutcomes(recurrence.previouslySeenItems, value.outcomes)
    && coverageMatchesOutcomes(recurrence.previouslySeenBytes, value.outcomes)
    && validFlags(recurrence.incomplete) && flagsMatchOutcomes(recurrence.incomplete, value.outcomes);
}

