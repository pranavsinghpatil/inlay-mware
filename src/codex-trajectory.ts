/** Content-free projection of Codex session JSONL records. */

export type GapReason =
  | "malformed_record"
  | "oversize_record"
  | "source_truncated"
  | "io_error"
  | "state_limit"
  | "incomplete_tail";

export type TrajectoryKind =
  | "turn_started"
  | "turn_finished"
  | "turn_aborted"
  | "context"
  | "tool_requested"
  | "tool_result"
  | "runtime_action"
  | "agent_activity"
  | "gap";

export type TrajectoryCategory =
  | "exec"
  | "orchestration"
  | "process"
  | "edit"
  | "connector"
  | "other"
  | "command"
  | "file_change"
  | "subagent"
  | "message";

export type TrajectoryOutcome = "reported_success" | "reported_failure" | "cancelled" | "unknown";
export type TrajectoryEvidence = "agent_reported_completion" | "tool_report" | "runtime_exit_code" | "runtime_status";
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

/** Persistable event: every value is a number, null, or member of a closed vocabulary. */
export interface TrajectoryEvent {
  version: 1;
  sequence: number;
  session: string;
  turn: number | null;
  action: number | null;
  kind: TrajectoryKind;
  category: TrajectoryCategory | null;
  outcome: TrajectoryOutcome | null;
  evidence: TrajectoryEvidence | null;
  elapsedMs: number | null;
  durationMs: number | null;
  inputBytes: number | null;
  outputBytes: number | null;
  exitCode: number | null;
  changedFiles: number | null;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  gapReason: GapReason | null;
}

const MAX_RECORD_BYTES = 256 * 1024;
const MAX_STATE_ENTRIES = 4096;
const MAX_DEPTH = 32;
const MAX_NODES = 16384;

const KINDS = new Set<TrajectoryKind>([
  "turn_started", "turn_finished", "turn_aborted", "context", "tool_requested", "tool_result", "runtime_action", "agent_activity", "gap",
]);
const CATEGORIES = new Set<TrajectoryCategory>([
  "exec", "orchestration", "process", "edit", "connector", "other", "command", "file_change", "subagent", "message",
]);
const OUTCOMES = new Set<TrajectoryOutcome>(["reported_success", "reported_failure", "cancelled", "unknown"]);
const EVIDENCE = new Set<TrajectoryEvidence>(["agent_reported_completion", "tool_report", "runtime_exit_code", "runtime_status"]);
const REASONING = new Set<ReasoningEffort>(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const GAPS = new Set<GapReason>(["malformed_record", "oversize_record", "source_truncated", "io_error", "state_limit", "incomplete_tail"]);

// This is deliberately an exact list. A model identifier supplied by the log is never copied through.
const MODELS = new Set([
  "gpt-5", "gpt-5-codex", "gpt-5.1", "gpt-5.1-codex", "gpt-5.2", "gpt-5.2-codex",
  "gpt-5.3-codex", "gpt-5.4", "gpt-5.4-mini", "gpt-6", "gpt-6-sol", "gpt-6-astra",
  "gpt-6.1-sol", "gpt-6-luna", "gpt-6.1-luna", "claude-3-5-sonnet", "claude-3-7-sonnet",
  "claude-sonnet-4", "claude-sonnet-4-5", "claude-opus-4", "claude-opus-4-1", "claude-haiku-4-5",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byteCount(value: unknown): number | null {
  let bytes = 0;
  let nodes = 0;
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return false;
    if (typeof item === "string") {
      bytes += Buffer.byteLength(JSON.stringify(item), "utf8");
    } else if (typeof item === "number" || typeof item === "boolean" || item === null) {
      bytes += String(item).length;
    } else if (Array.isArray(item)) {
      if (seen.has(item)) return false;
      seen.add(item);
      bytes += 2;
      let index = 0;
      for (const child of item) {
        if (index++ > 0) bytes += 1;
        if (!visit(child, depth + 1)) return false;
        if (bytes > MAX_RECORD_BYTES) return false;
      }
      seen.delete(item);
    } else if (isObject(item)) {
      if (seen.has(item)) return false;
      seen.add(item);
      bytes += 2;
      let index = 0;
      for (const [key, child] of Object.entries(item)) {
        if (index++ > 0) bytes += 1;
        bytes += Buffer.byteLength(JSON.stringify(key), "utf8") + 1;
        if (!visit(child, depth + 1)) return false;
        if (bytes > MAX_RECORD_BYTES) return false;
      }
      seen.delete(item);
    } else {
      return false;
    }
    return bytes <= MAX_RECORD_BYTES;
  };
  return visit(value, 0) ? bytes : null;
}

function safeBytes(value: unknown): number | null {
  return byteCount(value);
}

function parseTime(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== "string" || value.length > 64) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function statusOutcome(value: unknown): TrajectoryOutcome | null {
  if (typeof value !== "string") return null;
  switch (value.toLowerCase()) {
    case "success": case "succeeded": case "complete": case "completed": case "applied": case "ok":
      return "reported_success";
    case "failure": case "failed": case "error": case "rejected":
      return "reported_failure";
    case "cancelled": case "canceled": case "aborted":
      return "cancelled";
    default: return null;
  }
}

function modelValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return MODELS.has(value.toLowerCase()) ? value.toLowerCase() : "other";
}

function effortValue(value: unknown): ReasoningEffort | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return REASONING.has(normalized as ReasoningEffort) ? normalized as ReasoningEffort : null;
}

function toolCategory(value: unknown): TrajectoryCategory {
  if (typeof value !== "string") return "other";
  const name = value.toLowerCase();
  if (name === "exec_command") return "exec";
  if (name === "exec") return "orchestration";
  if (["shell", "bash", "powershell"].includes(name)) return "exec";
  if (["write_stdin", "process", "spawn", "terminal"].includes(name)) return "process";
  if (["apply_patch", "write_file", "edit_file"].includes(name)) return "edit";
  if (["create_thread", "send_message_to_thread", "handoff_thread", "wait_threads", "fork_thread"].includes(name)) return "orchestration";
  if (name.startsWith("mcp__") || name.includes("connector")) return "connector";
  return "other";
}

function durationFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (!isObject(value)) return null;
  const secs = value.secs;
  const nanos = value.nanos;
  if (typeof secs === "number" && Number.isFinite(secs) && secs >= 0 && typeof nanos === "number" && Number.isFinite(nanos) && nanos >= 0) {
    const milliseconds = secs * 1000 + nanos / 1_000_000;
    return Number.isSafeInteger(Math.round(milliseconds)) ? Math.round(milliseconds) : null;
  }
  return null;
}

/** Strictly validates the exact public event shape and closed vocabularies. */
export function isTrajectoryEvent(value: unknown): value is TrajectoryEvent {
  if (!isObject(value)) return false;
  const fields = ["version", "sequence", "session", "turn", "action", "kind", "category", "outcome", "evidence", "elapsedMs", "durationMs", "inputBytes", "outputBytes", "exitCode", "changedFiles", "model", "reasoningEffort", "gapReason"];
  if (Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) return false;
  const numeric = (entry: unknown): boolean => entry === null || (typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0);
  return value.version === 1
    && numeric(value.sequence) && value.sequence !== null
    && typeof value.session === "string" && /^[a-f0-9]{32}$/.test(value.session)
    && numeric(value.turn) && numeric(value.action)
    && typeof value.kind === "string" && KINDS.has(value.kind as TrajectoryKind)
    && (value.category === null || (typeof value.category === "string" && CATEGORIES.has(value.category as TrajectoryCategory)))
    && (value.outcome === null || (typeof value.outcome === "string" && OUTCOMES.has(value.outcome as TrajectoryOutcome)))
    && (value.evidence === null || (typeof value.evidence === "string" && EVIDENCE.has(value.evidence as TrajectoryEvidence)))
    && [value.elapsedMs, value.durationMs, value.inputBytes, value.outputBytes, value.changedFiles].every(numeric)
    && (value.exitCode === null || (typeof value.exitCode === "number" && Number.isSafeInteger(value.exitCode)))
    && (value.model === null || value.model === "other" || (typeof value.model === "string" && MODELS.has(value.model)))
    && (value.reasoningEffort === null || (typeof value.reasoningEffort === "string" && REASONING.has(value.reasoningEffort as ReasoningEffort)))
    && (value.gapReason === null || (typeof value.gapReason === "string" && GAPS.has(value.gapReason as GapReason)));
}

/**
 * Projects supported Codex JSONL records into content-free events. Raw source IDs
 * are used only as transient map keys and never appear in the returned object.
 */
export class CodexTrajectoryProjector {
  readonly #sourceKey: string;
  #sequence = 0;
  #nextTurn = 0;
  #nextAction = 0;
  #baseline: number | null = null;
  #lastElapsed = -1;
  #turns = new Map<string, number>();
  #activeTurns = new Set<string>();
  #calls = new Map<string, { action: number; category: TrajectoryCategory; turn: number | null }>();
  #seenRuntimeItems = new Set<string>();
  #runtimeItemOrder: string[] = [];

  constructor(sourceKey: string) {
    if (!/^[a-f0-9]{32}$/.test(sourceKey)) throw new TypeError("sourceKey must be a 32-character lowercase hex pseudonym");
    this.#sourceKey = sourceKey;
  }

  gap(reason: GapReason): TrajectoryEvent {
    if (!GAPS.has(reason)) throw new TypeError("unsupported trajectory gap reason");
    return this.#event({ kind: "gap", gapReason: reason });
  }

  accept(record: unknown): TrajectoryEvent | null {
    if (!isObject(record)) return this.gap("malformed_record");
    if (byteCount(record) === null) return this.gap("oversize_record");
    const type = record.type;
    const payload = record.payload;
    if (typeof type !== "string" || !isObject(payload)) return this.gap("malformed_record");
    const elapsedMs = this.#elapsed(record, payload);

    if (type === "event_msg") {
      const eventType = payload.type;
      if (typeof eventType !== "string") return this.gap("malformed_record");
      const rawTurnId = payload.turn_id ?? payload.root_turn_id;
      if (typeof rawTurnId === "string" && rawTurnId.length > 0 && !this.#turns.has(rawTurnId) && this.#turns.size >= MAX_STATE_ENTRIES) return this.gap("state_limit");
      const turn = this.#turn(payload.turn_id ?? payload.root_turn_id);
      if (eventType === "task_started") {
        if (typeof rawTurnId === "string" && rawTurnId.length > 0 && rawTurnId.length <= 256 && this.#turns.has(rawTurnId)) this.#activeTurns.add(rawTurnId);
        return this.#event({ kind: "turn_started", turn, outcome: null, elapsedMs });
      }
      if (eventType === "task_complete") {
        if (typeof rawTurnId === "string") this.#activeTurns.delete(rawTurnId);
        return this.#event({ kind: "turn_finished", turn, outcome: "unknown", evidence: "agent_reported_completion", durationMs: durationFrom(payload.duration_ms), elapsedMs });
      }
      if (eventType === "turn_aborted") {
        if (typeof rawTurnId === "string") this.#activeTurns.delete(rawTurnId);
        return this.#event({ kind: "turn_aborted", turn, outcome: "cancelled", evidence: "agent_reported_completion", durationMs: durationFrom(payload.duration_ms), elapsedMs });
      }
      if (eventType === "item_completed") return this.#runtimeItem(payload, turn, elapsedMs);
      return null;
    }

    if (type === "turn_context") {
      if (typeof payload.turn_id === "string" && payload.turn_id.length > 0 && !this.#turns.has(payload.turn_id) && this.#turns.size >= MAX_STATE_ENTRIES) return this.gap("state_limit");
      const turn = this.#turn(payload.turn_id);
      if (typeof payload.turn_id === "string" && payload.turn_id.length > 0 && payload.turn_id.length <= 256 && this.#turns.has(payload.turn_id)) this.#activeTurns.add(payload.turn_id);
      return this.#event({ kind: "context", turn, model: modelValue(payload.model), reasoningEffort: effortValue(payload.effort), elapsedMs });
    }

    if (type === "response_item") return this.#responseItem(payload, elapsedMs);
    return null;
  }

  #event(fields: Partial<TrajectoryEvent>): TrajectoryEvent {
    const event: TrajectoryEvent = {
      version: 1,
      sequence: ++this.#sequence,
      session: this.#sourceKey,
      turn: null,
      action: null,
      kind: "gap",
      category: null,
      outcome: null,
      evidence: null,
      elapsedMs: null,
      durationMs: null,
      inputBytes: null,
      outputBytes: null,
      exitCode: null,
      changedFiles: null,
      model: null,
      reasoningEffort: null,
      gapReason: null,
      ...fields,
    };
    if (!isTrajectoryEvent(event)) throw new Error("internal trajectory event violated its schema");
    return event;
  }

  #turn(id: unknown): number | null {
    if (typeof id !== "string" || id.length === 0 || id.length > 256) return null;
    const existing = this.#turns.get(id);
    if (existing !== undefined) return existing;
    if (this.#turns.size >= MAX_STATE_ENTRIES) return null;
    const ordinal = ++this.#nextTurn;
    this.#turns.set(id, ordinal);
    return ordinal;
  }

  #elapsed(record: Record<string, unknown>, payload: Record<string, unknown>): number | null {
    const candidate = parseTime(record.timestamp)
      ?? parseTime(payload.completed_at_ms)
      ?? parseTime(payload.started_at_ms)
      ?? parseTime(payload.started_at)
      ?? parseTime(payload.completed_at);
    if (candidate === null) return null;
    if (this.#baseline === null) this.#baseline = candidate;
    const elapsed = candidate - this.#baseline;
    if (elapsed < 0 || elapsed < this.#lastElapsed || !Number.isSafeInteger(elapsed)) return null;
    this.#lastElapsed = elapsed;
    return elapsed;
  }

  #responseItem(payload: Record<string, unknown>, elapsedMs: number | null): TrajectoryEvent | null {
    const type = payload.type;
    if (type === "function_call" || type === "custom_tool_call") {
      const callId = payload.call_id;
      if (typeof callId !== "string" || callId.length === 0 || callId.length > 256) return null;
      if (this.#calls.has(callId)) return this.gap("malformed_record");
      if (this.#calls.size >= MAX_STATE_ENTRIES) return this.gap("state_limit");
      const association = this.#responseTurn(payload);
      if (association.stateLimit) return this.gap("state_limit");
      const turn = association.turn;
      const joinedCategory = nameCategoryFor(payload.name, payload.namespace);
      const action = ++this.#nextAction;
      this.#calls.set(callId, { action, category: joinedCategory, turn });
      return this.#event({ kind: "tool_requested", turn, action, category: joinedCategory, inputBytes: safeBytes(payload.arguments ?? payload.input), elapsedMs });
    }
    if (type === "function_call_output" || type === "custom_tool_call_output") {
      const callId = payload.call_id;
      if (typeof callId !== "string" || callId.length === 0 || callId.length > 256) return this.gap("malformed_record");
      const pending = this.#calls.get(callId);
      if (!pending) {
        const association = this.#responseTurn(payload);
        if (association.stateLimit) return this.gap("state_limit");
        return this.#event({ kind: "tool_result", turn: association.turn, category: "other", outcome: "unknown", evidence: "tool_report", outputBytes: safeBytes(payload.output), elapsedMs });
      }
      this.#calls.delete(callId);
      return this.#event({ kind: "tool_result", turn: pending.turn, action: pending.action, category: pending.category, evidence: "tool_report", outcome: "unknown", outputBytes: safeBytes(payload.output), elapsedMs });
    }
    return null;
  }

  #runtimeItem(payload: Record<string, unknown>, turn: number | null, elapsedMs: number | null): TrajectoryEvent | null {
    const item = payload.item;
    if (!isObject(item) || typeof item.type !== "string") return null;
    if (item.type !== "CommandExecution" && item.type !== "FileChange") {
      const category: TrajectoryCategory | null = item.type === "SubAgentActivity" ? "subagent"
        : item.type === "AgentMessage" || item.type === "UserMessage" ? "message" : null;
      if (!category) return null;
      return this.#event({ kind: "agent_activity", category, turn, elapsedMs });
    }
    const id = item.id;
    if (typeof id === "string" && id.length > 0 && id.length <= 256) {
      if (this.#seenRuntimeItems.has(id)) return null;
      if (this.#seenRuntimeItems.size >= MAX_STATE_ENTRIES) {
        const evicted = this.#runtimeItemOrder.shift();
        if (evicted !== undefined) this.#seenRuntimeItems.delete(evicted);
      }
      this.#seenRuntimeItems.add(id);
      this.#runtimeItemOrder.push(id);
    }
    const action = ++this.#nextAction;
    if (item.type === "CommandExecution") {
      const exitCode = typeof item.exit_code === "number" && Number.isSafeInteger(item.exit_code) ? item.exit_code : null;
      const rawStatus = statusOutcome(item.status);
      const status = rawStatus === "reported_failure" || rawStatus === "cancelled" ? rawStatus : null;
      const outcome = exitCode !== null ? (exitCode === 0 ? "reported_success" : "reported_failure") : status ?? "unknown";
      const measuredDuration = durationFrom(item.duration)
        ?? durationFrom(payload.duration)
        ?? intervalDuration(payload.started_at_ms, payload.completed_at_ms);
      return this.#event({
        kind: "runtime_action", category: "command", turn, action, outcome,
        evidence: exitCode !== null ? "runtime_exit_code" : status !== null ? "runtime_status" : null,
        durationMs: measuredDuration, exitCode, elapsedMs,
      });
    }
    if (item.type === "FileChange") {
      const changedFiles = isObject(item.changes) ? Object.keys(item.changes).length : null;
      const outcome = statusOutcome(item.status);
      return this.#event({ kind: "runtime_action", category: "file_change", turn, action, outcome: outcome ?? "unknown", evidence: outcome !== null ? "runtime_status" : null, changedFiles, elapsedMs });
    }
    return null;
  }

  #singleActiveTurn(): number | null {
    if (this.#activeTurns.size !== 1) return null;
    const id = this.#activeTurns.values().next().value;
    return typeof id === "string" ? this.#turns.get(id) ?? null : null;
  }

  #responseTurn(payload: Record<string, unknown>): { turn: number | null; stateLimit: boolean } {
    if (!Object.hasOwn(payload, "turn_id")) return { turn: this.#singleActiveTurn(), stateLimit: false };
    const id = payload.turn_id;
    if (typeof id !== "string" || id.length === 0 || id.length > 256) return { turn: null, stateLimit: false };
    if (!this.#turns.has(id) && this.#turns.size >= MAX_STATE_ENTRIES) return { turn: null, stateLimit: true };
    return { turn: this.#turn(id), stateLimit: false };
  }
}

function nameCategoryFor(name: unknown, namespace: unknown): TrajectoryCategory {
  const nameCategory = toolCategory(name);
  return nameCategory === "other" && toolCategory(namespace) === "connector" ? "connector" : nameCategory;
}

function intervalDuration(started: unknown, completed: unknown): number | null {
  if (typeof started !== "number" || typeof completed !== "number" || !Number.isSafeInteger(started) || !Number.isSafeInteger(completed) || completed < started) return null;
  return completed - started;
}
