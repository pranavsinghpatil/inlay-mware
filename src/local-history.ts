import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ObservationTotals, RecurrenceSummary } from "./local-observation.ts";
import type { ExchangeLifecycleSnapshot } from "./exchange-lifecycle.ts";
import { isObservationTotals } from "./local-observation.ts";

export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  state: "running" | "closed" | "end_unknown";
  totals: ObservationTotals;
  lifecycle: ExchangeLifecycleSnapshot;
  recurrence: RecurrenceSummary | null;
}

export type LocalHistoryUnavailableReason = "locked" | "invalid_history" | "io_error";
export type LocalHistoryStatus = "off" | "ready" | "unavailable";

export interface LocalHistorySnapshot {
  status: LocalHistoryStatus;
  reason: LocalHistoryUnavailableReason | null;
  retentionSessions: number;
  sessions: SessionSummary[];
}

const HISTORY_FILENAME = "inlay-history.json";
const LOCK_FILENAME = "inlay-history.lock";
const TEMP_FILENAME = "inlay-history.tmp";
export const MAX_LOCAL_HISTORY_BYTES = 2 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LIFECYCLE_REASONS = new Set(["overflow", "invalid_transition", "callback_rejection"]);
const DATA_KEYS = new Set(["version", "sessions"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 24) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isLifecycle(value: unknown): value is ExchangeLifecycleSnapshot {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "admitted", "active", "forwarding", "finalized", "availability", "incomplete", "unavailableReason",
  ])) return false;
  const counts = [value.admitted, value.active, value.forwarding, value.finalized];
  if (typeof value.incomplete !== "boolean") return false;
  if (value.availability === "AVAILABLE") {
    if (counts.some((count) => !isCount(count)) || value.incomplete !== false || value.unavailableReason !== null) return false;
    const admitted = value.admitted as number;
    const active = value.active as number;
    const forwarding = value.forwarding as number;
    const finalized = value.finalized as number;
    const completedTotal = active + finalized;
    return Number.isSafeInteger(completedTotal) && admitted === completedTotal && forwarding <= admitted;
  }
  if (value.availability !== "UNAVAILABLE" || value.incomplete !== true) return false;
  if (counts.some((count) => count !== null)) return false;
  return typeof value.unavailableReason === "string" && LIFECYCLE_REASONS.has(value.unavailableReason);
}

function isRecurrence(value: unknown): value is RecurrenceSummary | null {
  if (value === null) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, ["recurringGroupCount", "groupsTruncated", "comparisonIncomplete"])) return false;
  const count = value.recurringGroupCount;
  const truncated = value.groupsTruncated;
  const incomplete = value.comparisonIncomplete;
  return (count === null || isCount(count))
    && (truncated === null || typeof truncated === "boolean")
    && (incomplete === null || typeof incomplete === "boolean");
}

function isSessionSummary(value: unknown): value is SessionSummary {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "sessionId", "startedAt", "updatedAt", "endedAt", "state", "totals", "lifecycle", "recurrence",
  ])) return false;
  if (typeof value.sessionId !== "string" || !UUID_PATTERN.test(value.sessionId)) return false;
  if (!isIsoTimestamp(value.startedAt) || !isIsoTimestamp(value.updatedAt)) return false;
  if (value.endedAt !== null && !isIsoTimestamp(value.endedAt)) return false;
  if (value.state !== "running" && value.state !== "closed" && value.state !== "end_unknown") return false;
  if (value.state === "closed" && value.endedAt === null) return false;
  if (value.state !== "closed" && value.endedAt !== null) return false;
  return isObservationTotals(value.totals) && isLifecycle(value.lifecycle) && isRecurrence(value.recurrence);
}

function cloneSummary(summary: SessionSummary): SessionSummary {
  return JSON.parse(JSON.stringify(summary)) as SessionSummary;
}

function encodeHistory(sessions: SessionSummary[]): string {
  return JSON.stringify({ version: 1, sessions });
}

function parseHistory(text: string, maxSessions: number): { sessions: SessionSummary[]; truncated: boolean } | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || !hasOnlyKeys(value, [...DATA_KEYS]) || value.version !== 1 || !Array.isArray(value.sessions)) return undefined;
    if (value.sessions.length > 100 || !value.sessions.every(isSessionSummary)) return undefined;
    const ids = new Set<string>();
    for (const session of value.sessions) {
      if (ids.has(session.sessionId)) return undefined;
      ids.add(session.sessionId);
    }
    return {
      sessions: value.sessions.slice(-maxSessions).map((session) => cloneSummary(session)),
      truncated: value.sessions.length > maxSessions,
    };
  } catch {
    return undefined;
  }
}

/** Opt-in bounded aggregate history. With no directory, this class performs no filesystem I/O. */
export class LocalHistory {
  readonly ready: Promise<void>;
  readonly #directory: string | undefined;
  readonly #maxSessions: number;
  readonly #sessions = new Map<string, SessionSummary>();
  #status: LocalHistoryStatus;
  #reason: LocalHistoryUnavailableReason | null = null;
  #lockOwned = false;
  #closing = false;
  #closed = false;
  #closePromise: Promise<void> | null = null;
  #inFlight: Promise<void> | null = null;
  #pending: { data: string; promise: Promise<void>; resolve: () => void } | null = null;

  constructor(dir?: string, maxSessions = 20) {
    if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 100) {
      throw new RangeError("maxSessions must be an integer from 1 to 100");
    }
    this.#directory = dir;
    this.#maxSessions = maxSessions;
    this.#status = dir === undefined ? "off" : "unavailable";
    if (dir === undefined) {
      this.ready = Promise.resolve();
    } else {
      this.ready = this.#initialize();
    }
  }

  snapshot(): LocalHistorySnapshot {
    return {
      status: this.#status,
      reason: this.#reason,
      retentionSessions: this.#maxSessions,
      sessions: [...this.#sessions.values()].map(cloneSummary),
    };
  }

  async save(summary: SessionSummary): Promise<void> {
    await this.ready;
    if (this.#closing || this.#closed || this.#status !== "ready") return;
    if (!isSessionSummary(summary)) {
      this.#fail("invalid_history");
      return;
    }
    this.#sessions.delete(summary.sessionId);
    this.#sessions.set(summary.sessionId, cloneSummary(summary));
    this.#trim();
    await this.#scheduleWrite();
  }

  close(finalSummary?: SessionSummary): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true;
    this.#closePromise = this.#finishClose(finalSummary);
    return this.#closePromise;
  }

  async #finishClose(finalSummary?: SessionSummary): Promise<void> {
    try {
      await this.ready;
      if (this.#status === "ready" && finalSummary !== undefined) {
        if (isSessionSummary(finalSummary)) {
          this.#sessions.delete(finalSummary.sessionId);
          this.#sessions.set(finalSummary.sessionId, cloneSummary(finalSummary));
          this.#trim();
          await this.#scheduleWrite();
        } else {
          this.#fail("invalid_history");
        }
      }
      await this.#flushWrites();
    } catch {
      this.#fail("io_error");
      await this.#flushWrites();
    } finally {
      this.#closed = true;
      await this.#releaseLock();
    }
  }

  async #flushWrites(): Promise<void> {
    while (this.#inFlight || this.#pending) {
      if (!this.#inFlight && this.#pending && this.#status === "ready") {
        void this.#drainWrites();
      }
      const inFlight = this.#inFlight;
      if (inFlight) await inFlight;
      else this.#resolvePending();
    }
  }

  async #initialize(): Promise<void> {
    const directory = this.#directory!;
    try {
      await mkdir(directory, { recursive: true });
      const lockPath = join(directory, LOCK_FILENAME);
      let lock;
      try {
        lock = await open(lockPath, "wx", 0o600);
      } catch (error) {
        const code = isRecord(error) ? error.code : undefined;
        this.#fail(code === "EEXIST" ? "locked" : "io_error");
        return;
      }
      this.#lockOwned = true;
      try {
        await lock.chmod(0o600);
      } finally {
        await lock.close();
      }

      const historyPath = join(directory, HISTORY_FILENAME);
      let fileStat;
      try {
        fileStat = await lstat(historyPath);
      } catch (error) {
        const code = isRecord(error) ? error.code : undefined;
        if (code === "ENOENT") {
          this.#status = "ready";
          return;
        }
        this.#fail("io_error");
        await this.#releaseLock();
        return;
      }
      if (!fileStat.isFile() || fileStat.size > MAX_LOCAL_HISTORY_BYTES) {
        this.#fail("invalid_history");
        await this.#releaseLock();
        return;
      }
      let recoveryChanged = false;
      let handle;
      try {
        handle = await open(historyPath, "r");
        const openedStat = await handle.stat();
        if (!openedStat.isFile() || openedStat.size > MAX_LOCAL_HISTORY_BYTES) {
          this.#fail("invalid_history");
          return;
        }
        const buffer = Buffer.alloc(MAX_LOCAL_HISTORY_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_LOCAL_HISTORY_BYTES) {
          this.#fail("invalid_history");
          return;
        }
        const parsed = parseHistory(buffer.subarray(0, bytesRead).toString("utf8"), this.#maxSessions);
        if (!parsed) {
          this.#fail("invalid_history");
          return;
        }
        this.#status = "ready";
        recoveryChanged = parsed.truncated;
        const recoveredAt = new Date().toISOString();
        for (const entry of parsed.sessions) {
          if (entry.state === "running") {
            entry.state = "end_unknown";
            entry.endedAt = null;
            entry.updatedAt = recoveredAt;
            recoveryChanged = true;
          }
          this.#sessions.set(entry.sessionId, entry);
        }
      } finally {
        await handle?.close();
        if (this.#status !== "ready") await this.#releaseLock();
      }
      if (recoveryChanged && this.#status === "ready") await this.#scheduleWrite();
    } catch {
      this.#fail("io_error");
      await this.#releaseLock();
    }
  }

  #trim(): void {
    while (this.#sessions.size > this.#maxSessions) {
      const oldest = this.#sessions.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this.#sessions.delete(oldest);
    }
  }

  #scheduleWrite(): Promise<void> {
    const data = encodeHistory([...this.#sessions.values()]);
    if (this.#pending) {
      this.#pending.data = data;
      return this.#pending.promise;
    }
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    this.#pending = { data, promise, resolve };
    if (!this.#inFlight) void this.#drainWrites();
    return promise;
  }

  async #drainWrites(): Promise<void> {
    const drain = async () => {
      while (this.#pending && this.#status === "ready") {
        const batch = this.#pending;
        this.#pending = null;
        try {
          await this.#atomicWrite(batch.data);
          batch.resolve();
        } catch {
          this.#fail("io_error");
          batch.resolve();
          this.#resolvePending();
        }
      }
    };
    this.#inFlight = drain();
    try {
      await this.#inFlight;
    } finally {
      this.#inFlight = null;
      if (this.#pending && this.#status === "ready") void this.#drainWrites();
    }
  }

  async #atomicWrite(data: string): Promise<void> {
    if (Buffer.byteLength(data, "utf8") > MAX_LOCAL_HISTORY_BYTES) throw new Error("history_limit");
    const directory = this.#directory!;
    const temporaryPath = join(directory, TEMP_FILENAME);
    const historyPath = join(directory, HISTORY_FILENAME);
    try {
      await unlink(temporaryPath);
    } catch (error) {
      const code = isRecord(error) ? error.code : undefined;
      if (code !== "ENOENT") throw error;
    }
    const temporary = await open(temporaryPath, "wx", 0o600);
    try {
      await temporary.chmod(0o600);
      await temporary.writeFile(data, "utf8");
      await temporary.sync();
    } finally {
      await temporary.close();
    }
    await rename(temporaryPath, historyPath);
  }

  #fail(reason: LocalHistoryUnavailableReason): void {
    this.#status = "unavailable";
    this.#reason = reason;
  }

  #resolvePending(): void {
    const pending = this.#pending;
    this.#pending = null;
    pending?.resolve();
  }

  async #releaseLock(): Promise<void> {
    if (!this.#lockOwned || this.#directory === undefined) return;
    this.#lockOwned = false;
    try {
      await unlink(join(this.#directory, LOCK_FILENAME));
    } catch {
      // Lock cleanup errors stay private and never escape into the proxy.
    }
  }
}
