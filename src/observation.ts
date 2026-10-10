import { StringDecoder } from "node:string_decoder";
import { createHmac, randomBytes } from "node:crypto";
import { zstdDecompressSync } from "node:zlib";

const MAX_SSE_EVENT_CHARS = 64 * 1024;
export const MAX_ZSTD_OBSERVATION_BYTES = 1024 * 1024;
export const MAX_EXACT_ITEM_RECURRENCE_BYTES = 1024 * 1024;
const MAX_EXACT_ITEM_GROUPS = 512;
const MAX_RECORDED_RECURRING_GROUPS = 64;

const RESPONSE_TOP_LEVEL_FIELDS = new Set([
  "background",
  "client_metadata",
  "conversation",
  "include",
  "input",
  "instructions",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "model",
  "parallel_tool_calls",
  "previous_response_id",
  "prompt_cache_key",
  "reasoning",
  "service_tier",
  "store",
  "stream",
  "temperature",
  "text",
  "tool_choice",
  "tools",
  "top_p",
  "truncation",
  "user",
]);

const RESPONSE_INPUT_ITEM_TYPES = new Set([
  "computer_call",
  "computer_call_output",
  "function_call",
  "function_call_output",
  "item_reference",
  "message",
  "reasoning",
]);

export interface TopLevelFieldMetric {
  name: string;
  count: number;
  canonicalJsonBytes: number;
}

export interface RequestStructure {
  /** UTF-8 bytes of the complete transient request after canonical JSON serialization. */
  canonicalStructuralBytesTotal: number;
  topLevelFieldCount: number;
  topLevelFields: TopLevelFieldMetric[];
  inputItemCount?: number;
  inputItemTypeCounts?: Record<string, number>;
  inputItemTypeCanonicalJsonBytes?: Record<string, number>;
}

export interface ExactItemRecurrenceRequest {
  comparedItemCount: number;
  previouslySeenItemCount: number;
  previouslySeenCanonicalJsonBytes: number;
  previouslySeenItemTypeCounts: Record<string, number>;
  previouslySeenItemTypeCanonicalJsonBytes: Record<string, number>;
  previouslySeenRoleCategoryCounts?: Record<string, number>;
  comparisonIncomplete: boolean;
  unavailableReason?: "content_encoded" | "input_limit" | "not_json" | "zstd_decode_failed" | "zstd_output_limit";
}

export interface ExactItemRecurrenceGroup {
  itemType: string;
  semanticRoleCategory?: string;
  canonicalJsonBytes: number;
  firstObservationSequence: number;
  lastObservationSequence: number;
  distinctRequestCount: number;
  occurrenceCount: number;
}

export interface ExactItemRecurrenceSummary {
  recurringGroupCount: number;
  groups: ExactItemRecurrenceGroup[];
  groupsTruncated: boolean;
  comparisonIncomplete: boolean;
}

export type RequestStructureUnavailableReason =
  | "content_encoded"
  | "not_json"
  | "zstd_decode_failed"
  | "zstd_output_limit";

export interface RequestStructureObservation {
  requestStructure?: RequestStructure;
  unavailableReason?: RequestStructureUnavailableReason;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
}

export interface ResponseStreamObservation {
  responseBytes: number;
  timeToFirstResponseBodyByteMs?: number;
  timeToTerminalEventMs?: number;
  usage?: ProviderUsage;
  terminalEventObserved: boolean;
  responseObservationIncomplete: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recognizedInputItemType(value: unknown): string {
  return isRecord(value) && typeof value.type === "string" && RESPONSE_INPUT_ITEM_TYPES.has(value.type)
    ? value.type
    : "other";
}

/** Returns only closed, non-content-bearing protocol roles. Unknown type strings never escape. */
function semanticRoleCategory(value: unknown): string {
  if (!isRecord(value)) return "unknown_item_shape";
  const type = typeof value.type === "string" ? value.type : undefined;
  if (type === "message") {
    const role = typeof value.role === "string" ? value.role : undefined;
    if (role === "user") return "message_user";
    if (role === "assistant") return "message_assistant";
    if (role === "developer" || role === "system") return "message_system_or_developer";
    return "message_other_role";
  }
  if (type === "reasoning") return "reasoning_state";
  if (type === "item_reference" || type === "compaction" || type === "configuration_update") return "protocol_state";
  if (type === "function_call" || type === "computer_call" || type === "web_search_call" || type === "file_search_call" || type === "code_interpreter_call" || type === "image_generation_call" || type === "tool_search_call" || type === "mcp_call" || type === "program") return "known_tool_call";
  if (type === "function_call_output" || type === "computer_call_output" || type === "tool_search_output" || type === "program_output") return "known_tool_output";
  return type === undefined ? "unknown_item_shape" : "unknown_item_type";
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, canonicalizeJson(entry)]),
  );
}

function canonicalJsonBytes(value: unknown): number {
  const encoded = JSON.stringify(canonicalizeJson(value));
  return encoded === undefined ? 0 : Buffer.byteLength(encoded, "utf8");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value)) ?? "";
}

function parseJsonRecord(body: Buffer): Record<string, unknown> | undefined {
  try {
    const payload: unknown = JSON.parse(body.toString("utf8"));
    return isRecord(payload) ? payload : undefined;
  } catch {
    return undefined;
  }
}

/** Derives content-free structure from a Responses request already buffered for forwarding. */
export function deriveResponsesRequestStructure(body: Buffer): RequestStructure | undefined {
  const payload = parseJsonRecord(body);
  if (!payload) return undefined;

  const fields = new Map<string, TopLevelFieldMetric>();
  for (const [key, value] of Object.entries(payload)) {
    const name = RESPONSE_TOP_LEVEL_FIELDS.has(key) ? key : "other";
    const existing = fields.get(name) ?? { name, count: 0, canonicalJsonBytes: 0 };
    existing.count += 1;
    existing.canonicalJsonBytes += canonicalJsonBytes(value);
    fields.set(name, existing);
  }

  const structure: RequestStructure = {
    canonicalStructuralBytesTotal: canonicalJsonBytes(payload),
    topLevelFieldCount: Object.keys(payload).length,
    topLevelFields: [...fields.values()].sort((left, right) => left.name.localeCompare(right.name)),
  };

  if (Array.isArray(payload.input)) {
    const inputItemTypeCounts: Record<string, number> = {};
    const inputItemTypeCanonicalJsonBytes: Record<string, number> = {};
    for (const item of payload.input) {
      const type = recognizedInputItemType(item);
      inputItemTypeCounts[type] = (inputItemTypeCounts[type] ?? 0) + 1;
      inputItemTypeCanonicalJsonBytes[type] = (inputItemTypeCanonicalJsonBytes[type] ?? 0) + canonicalJsonBytes(item);
    }
    structure.inputItemCount = payload.input.length;
    structure.inputItemTypeCounts = inputItemTypeCounts;
    structure.inputItemTypeCanonicalJsonBytes = inputItemTypeCanonicalJsonBytes;
  }

  return structure;
}

interface InternalExactItemGroup {
  itemType: string;
  semanticRoleCategory?: string;
  canonicalJsonBytes: number;
  firstObservationSequence: number;
  lastObservationSequence: number;
  distinctRequestCount: number;
  occurrenceCount: number;
}

/**
 * Correlates byte-identical canonical input items only while this process is alive.
 * The keyed HMAC digest and its random key never leave this instance; metrics expose
 * only aggregate type, size, and sequence-span information.
 */
export class ExactItemRecurrenceTracker {
  #key = randomBytes(32);
  #groups = new Map<string, InternalExactItemGroup>();
  #comparisonIncomplete = false;
  #includeSemanticRoleCategories: boolean;

  constructor(includeSemanticRoleCategories = false) {
    this.#includeSemanticRoleCategories = includeSemanticRoleCategories;
  }

  observe(
    observationSequence: number,
    body: Buffer,
    contentEncoding: "identity" | "br" | "deflate" | "gzip" | "zstd" | "other",
  ): ExactItemRecurrenceRequest {
    const payload = this.#decode(body, contentEncoding);
    if (!payload.record) {
      return {
        comparedItemCount: 0,
        previouslySeenItemCount: 0,
        previouslySeenCanonicalJsonBytes: 0,
        previouslySeenItemTypeCounts: {},
        previouslySeenItemTypeCanonicalJsonBytes: {},
        ...(this.#includeSemanticRoleCategories ? { previouslySeenRoleCategoryCounts: {} } : {}),
        comparisonIncomplete: payload.unavailableReason !== undefined || this.#comparisonIncomplete,
        unavailableReason: payload.unavailableReason,
      };
    }

    const input = Array.isArray(payload.record.input) ? payload.record.input : [];
    const result: ExactItemRecurrenceRequest = {
      comparedItemCount: 0,
      previouslySeenItemCount: 0,
      previouslySeenCanonicalJsonBytes: 0,
      previouslySeenItemTypeCounts: {},
      previouslySeenItemTypeCanonicalJsonBytes: {},
      ...(this.#includeSemanticRoleCategories ? { previouslySeenRoleCategoryCounts: {} } : {}),
      comparisonIncomplete: this.#comparisonIncomplete,
    };

    for (const item of input) {
      const itemType = recognizedInputItemType(item);
      const roleCategory = this.#includeSemanticRoleCategories ? semanticRoleCategory(item) : undefined;
      const canonical = canonicalJson(item);
      const canonicalBytes = Buffer.byteLength(canonical, "utf8");
      const digest = createHmac("sha256", this.#key).update(canonical, "utf8").digest("hex");
      const existing = this.#groups.get(digest);
      result.comparedItemCount += 1;

      if (existing && existing.lastObservationSequence < observationSequence) {
        result.previouslySeenItemCount += 1;
        result.previouslySeenCanonicalJsonBytes += canonicalBytes;
        result.previouslySeenItemTypeCounts[itemType] = (result.previouslySeenItemTypeCounts[itemType] ?? 0) + 1;
        result.previouslySeenItemTypeCanonicalJsonBytes[itemType] = (result.previouslySeenItemTypeCanonicalJsonBytes[itemType] ?? 0) + canonicalBytes;
        if (roleCategory && result.previouslySeenRoleCategoryCounts) {
          result.previouslySeenRoleCategoryCounts[roleCategory] = (result.previouslySeenRoleCategoryCounts[roleCategory] ?? 0) + 1;
        }
      }

      if (existing) {
        existing.occurrenceCount += 1;
        if (existing.lastObservationSequence !== observationSequence) {
          existing.lastObservationSequence = observationSequence;
          existing.distinctRequestCount += 1;
        }
        continue;
      }

      if (this.#groups.size >= MAX_EXACT_ITEM_GROUPS) {
        this.#comparisonIncomplete = true;
        result.comparisonIncomplete = true;
        continue;
      }

      this.#groups.set(digest, {
        itemType,
        semanticRoleCategory: roleCategory,
        canonicalJsonBytes: canonicalBytes,
        firstObservationSequence: observationSequence,
        lastObservationSequence: observationSequence,
        distinctRequestCount: 1,
        occurrenceCount: 1,
      });
    }

    return result;
  }

  snapshot(): ExactItemRecurrenceSummary {
    const recurringGroups = [...this.#groups.values()]
      .filter((group) => group.distinctRequestCount >= 2)
      .sort((left, right) => right.canonicalJsonBytes * right.occurrenceCount - left.canonicalJsonBytes * left.occurrenceCount);

    return {
      recurringGroupCount: recurringGroups.length,
      groups: recurringGroups.slice(0, MAX_RECORDED_RECURRING_GROUPS),
      groupsTruncated: recurringGroups.length > MAX_RECORDED_RECURRING_GROUPS,
      comparisonIncomplete: this.#comparisonIncomplete,
    };
  }

  #decode(
    body: Buffer,
    contentEncoding: "identity" | "br" | "deflate" | "gzip" | "zstd" | "other",
  ): { record?: Record<string, unknown>; unavailableReason?: ExactItemRecurrenceRequest["unavailableReason"] } {
    if (contentEncoding === "identity") {
      if (body.length > MAX_EXACT_ITEM_RECURRENCE_BYTES) return { unavailableReason: "input_limit" };
      const record = parseJsonRecord(body);
      return record ? { record } : { unavailableReason: "not_json" };
    }
    if (contentEncoding !== "zstd") return { unavailableReason: "content_encoded" };

    try {
      const decoded = zstdDecompressSync(body, { maxOutputLength: MAX_EXACT_ITEM_RECURRENCE_BYTES });
      const record = parseJsonRecord(decoded);
      return record ? { record } : { unavailableReason: "not_json" };
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      return { unavailableReason: code === "ERR_BUFFER_TOO_LARGE" ? "zstd_output_limit" : "zstd_decode_failed" };
    }
  }
}

/**
 * Decodes a zstd request only while deriving content-free structure.
 * The decoded buffer is bounded and is not returned or retained.
 */
export function observeZstdResponsesRequestStructure(body: Buffer): RequestStructureObservation {
  try {
    const decoded = zstdDecompressSync(body, { maxOutputLength: MAX_ZSTD_OBSERVATION_BYTES });
    const requestStructure = deriveResponsesRequestStructure(decoded);
    return requestStructure ? { requestStructure } : { unavailableReason: "not_json" };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    return { unavailableReason: code === "ERR_BUFFER_TOO_LARGE" ? "zstd_output_limit" : "zstd_decode_failed" };
  }
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function extractUsage(value: unknown): ProviderUsage | undefined {
  if (!isRecord(value)) return undefined;
  const candidates = [value.usage, isRecord(value.response) ? value.response.usage : undefined];
  let result: ProviderUsage | undefined;

  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const details = isRecord(candidate.input_tokens_details) ? candidate.input_tokens_details : undefined;
    const usage: ProviderUsage = {
      inputTokens: numeric(candidate.input_tokens),
      outputTokens: numeric(candidate.output_tokens),
      totalTokens: numeric(candidate.total_tokens),
      cachedInputTokens: numeric(details?.cached_tokens) ?? numeric(candidate.cached_input_tokens),
    };
    if (Object.values(usage).some((entry) => entry !== undefined)) {
      result = { ...result, ...Object.fromEntries(Object.entries(usage).filter(([, entry]) => entry !== undefined)) };
    }
  }

  return result;
}

/** Observes Responses SSE frames while immediately discarding their content. */
export class ResponsesStreamObserver {
  #decoder = new StringDecoder("utf8");
  #pending = "";
  #delimiterTail = "";
  #discardingOversizedEvent = false;
  #responseBytes = 0;
  #timeToFirstResponseBodyByteMs: number | undefined;
  #timeToTerminalEventMs: number | undefined;
  #usage: ProviderUsage | undefined;
  #terminalEventObserved = false;
  #responseObservationIncomplete = false;

  observe(chunk: Buffer, elapsedMs: number): void {
    this.#responseBytes += chunk.length;
    if (chunk.length > 0 && this.#timeToFirstResponseBodyByteMs === undefined) {
      this.#timeToFirstResponseBodyByteMs = elapsedMs;
    }

    const decoded = this.#decoder.write(chunk);
    for (let index = 0; index < decoded.length; index += 1) {
      const character = decoded[index];
      // Fixed-size framing state survives discarded content and chunk boundaries.
      this.#delimiterTail = (this.#delimiterTail + character).slice(-4);
      const delimiter = /\r?\n\r?\n$/.exec(this.#delimiterTail);

      if (!this.#discardingOversizedEvent) {
        if (this.#pending.length === MAX_SSE_EVENT_CHARS) {
          this.#responseObservationIncomplete = true;
          this.#pending = "";
          this.#discardingOversizedEvent = true;
        } else {
          this.#pending += character;
        }
      }

      if (delimiter) {
        if (!this.#discardingOversizedEvent) {
          this.#observeEvent(this.#pending.slice(0, -delimiter[0].length), elapsedMs);
        }
        this.#pending = "";
        this.#delimiterTail = "";
        this.#discardingOversizedEvent = false;
      }
    }
  }

  snapshot(): ResponseStreamObservation {
    return {
      responseBytes: this.#responseBytes,
      timeToFirstResponseBodyByteMs: this.#timeToFirstResponseBodyByteMs,
      timeToTerminalEventMs: this.#timeToTerminalEventMs,
      usage: this.#usage,
      terminalEventObserved: this.#terminalEventObserved,
      responseObservationIncomplete: this.#responseObservationIncomplete,
    };
  }

  /** Marks a final unterminated SSE frame as unavailable without affecting forwarded bytes. */
  finish(): void {
    const decoderTail = this.#decoder.end();
    if (this.#pending !== "" || decoderTail !== "" || this.#discardingOversizedEvent) {
      this.#responseObservationIncomplete = true;
    }
    this.#pending = "";
    this.#delimiterTail = "";
    this.#discardingOversizedEvent = false;
  }

  #observeEvent(event: string, elapsedMs: number): void {
    if (event.length > MAX_SSE_EVENT_CHARS) return;
    const lines = event.split(/\r?\n/);
    if (lines.some((line) => line.startsWith("event:") && line.slice("event:".length).trim() === "response.completed")) {
      this.#terminalEventObserved = true;
      this.#timeToTerminalEventMs ??= elapsedMs;
    }
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");
    if (data === "" || data.length > MAX_SSE_EVENT_CHARS) return;

    try {
      const payload = JSON.parse(data);
      if (isRecord(payload) && payload.type === "response.completed") {
        this.#terminalEventObserved = true;
        this.#timeToTerminalEventMs ??= elapsedMs;
      }
      const usage = extractUsage(payload);
      if (usage) this.#usage = { ...this.#usage, ...usage };
    } catch {
      // Non-JSON SSE data and malformed provider events are ignored.
    }
  }
}
