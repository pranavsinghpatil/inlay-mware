import { appendFile, mkdir, open, readdir, lstat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { isTrajectoryEvent, type TrajectoryEvent } from "./codex-trajectory.ts";

const KEY = /^[a-f0-9]{32}$/;
const MAX_LINE = 4096;
export interface StoredTrajectoryEvent { sourceOffset: number; event: TrajectoryEvent }
export interface TrajectorySummary {
  session: string; events: number; sourceOffset: number; turns: number; actions: number;
  reportedSuccess: number; reportedFailure: number; cancelled: number; unknown: number;
  gaps: number; models: string[]; taskVerification: "unavailable";
}
const count = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
export function isStoredEvent(x: unknown): x is StoredTrajectoryEvent {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const r = x as Record<string, unknown>;
  return Object.keys(r).length === 2 && count(r.sourceOffset) && isTrajectoryEvent(r.event);
}
function fresh(session: string): TrajectorySummary {
  return { session, events: 0, sourceOffset: 0, turns: 0, actions: 0,
    reportedSuccess: 0, reportedFailure: 0, cancelled: 0, unknown: 0, gaps: 0,
    models: [], taskVerification: "unavailable" };
}
function add(s: TrajectorySummary, r: StoredTrajectoryEvent): void {
  const e = r.event;
  s.events++; s.sourceOffset = r.sourceOffset;
  if (e.kind === "turn_started") s.turns++;
  // Wrapper requests/results are distinct from reported runtime executions.
  if (e.kind === "runtime_action") {
    s.actions++;
    if (e.outcome === "reported_success") s.reportedSuccess++;
    else if (e.outcome === "reported_failure") s.reportedFailure++;
    else if (e.outcome === "cancelled") s.cancelled++;
    else s.unknown++;
  }
  if (e.kind === "gap") s.gaps++;
  if (e.model !== null && !s.models.includes(e.model)) s.models.push(e.model);
}

/** Append-only closed metadata; no source body, path, call ID or original timestamp. */
export class TrajectoryStore {
  readonly ready: Promise<void>;
  readonly directory: string;
  readonly maxBytes: number;
  #summaries = new Map<string, TrajectorySummary>();
  #lastEvents = new Map<string, { sourceOffset: number; kind: string; gapReason: string | null }>();
  #pausedSources = new Set<string>();
  #bytes = 0;
  #status: "loading" | "ready" | "unavailable" = "loading";
  #reason: "locked" | "io_error" | "invalid_archive" | "storage_full" | null = null;
  #ownsLock = false;
  #closed = false;
  #queue: Promise<unknown> = Promise.resolve();
  constructor(directory: string, maxBytes = 512 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 4096) throw new Error("Invalid trajectory storage limit.");
    this.directory = directory; this.maxBytes = maxBytes;
    this.ready = this.#initialize();
  }
  get status() { return this.#status; }
  snapshot() {
    return { status: this.#status, reason: this.#reason, bytes: this.#bytes, maxBytes: this.maxBytes,
      retention: "append-only metadata; no automatic eviction", sessions: [...this.#summaries.values()].map(s => ({ ...s, models: [...s.models] })) };
  }
  checkpoint(session: string): number { return this.#summaries.get(session)?.sourceOffset ?? 0; }
  isPaused(session: string): boolean { return this.#pausedSources.has(session); }
  async #initialize(): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const root = await lstat(this.directory);
      if (!root.isDirectory() || root.isSymbolicLink()) throw new Error();
      try { const lock = await open(join(this.directory, "observer.lock"), "wx", 0o600); await lock.close(); this.#ownsLock = true; }
      catch { this.#reason = "locked"; this.#status = "unavailable"; return; }
      const files = await readdir(this.directory, { withFileTypes: true });
      if (files.length > 10002) throw new Error();
      for (const f of files) {
        if (!f.name.endsWith(".jsonl")) continue;
        const key = f.name.slice(0, -6);
        if (!KEY.test(key) || !f.isFile() || f.isSymbolicLink()) throw new Error();
        const s = fresh(key); let sequence = 0;
        await this.#read(key, r => {
          if (r.event.session !== key || r.event.sequence !== ++sequence || r.sourceOffset < s.sourceOffset) throw new Error();
          add(s, r);
          this.#lastEvents.set(key, { sourceOffset: r.sourceOffset, kind: r.event.kind, gapReason: r.event.gapReason });
          if (r.event.gapReason === "source_truncated") this.#pausedSources.add(key);
        });
        this.#summaries.set(key, s);
        this.#bytes += (await lstat(join(this.directory, f.name))).size;
      }
      if (this.#bytes >= this.maxBytes) { this.#reason = "storage_full"; this.#status = "unavailable"; }
      else this.#status = "ready";
    } catch { this.#reason = "invalid_archive"; this.#status = "unavailable"; }
  }
  async #read(key: string, visit: (r: StoredTrajectoryEvent) => void | boolean): Promise<void> {
    if (!KEY.test(key)) throw new Error();
    const file = join(this.directory, key + ".jsonl");
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > this.maxBytes) throw new Error();
    const h = await open(file, "r");
    try {
      const buffer = Buffer.alloc(64 * 1024); let offset = 0; let pending = Buffer.alloc(0);
      while (offset < info.size) {
        const { bytesRead } = await h.read(buffer, 0, Math.min(buffer.length, info.size - offset), offset);
        if (!bytesRead) throw new Error(); offset += bytesRead;
        pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
        let start = 0;
        for (let i = 0; i < pending.length; i++) if (pending[i] === 10) {
          const line = pending.subarray(start, i); start = i + 1;
          if (line.length === 0 || line.length > MAX_LINE) throw new Error();
          const r: unknown = JSON.parse(line.toString("utf8"));
          if (!isStoredEvent(r)) throw new Error();
          if (visit(r) === false) return;
        }
        pending = Buffer.from(pending.subarray(start));
        if (pending.length > MAX_LINE) throw new Error();
      }
      // Do not hide or overwrite a torn/invalid archive tail.
      if (pending.length) throw new Error();
    } finally { await h.close(); }
  }
  async page(session: string, after = 0, latest = false): Promise<{ rows: TrajectoryEvent[]; next: number | null }> {
    await this.ready;
    if (!KEY.test(session) || !count(after) || !this.#summaries.has(session)) return { rows: [], next: null };
    if (latest) after = Math.max(0, (this.#summaries.get(session)?.events ?? 0) - 200);
    const rows: TrajectoryEvent[] = []; let more = false;
    await this.#read(session, r => {
      if (r.event.sequence <= after) return;
      if (rows.length === 200) { more = true; return false; }
      rows.push(r.event);
    });
    return { rows, next: more ? rows.at(-1)!.sequence : null };
  }
  append(event: TrajectoryEvent, sourceOffset: number): Promise<boolean> {
    const task = this.#queue.then(async () => {
      await this.ready;
      if (this.#closed || this.#status !== "ready") return false;
      if (!isTrajectoryEvent(event) || !count(sourceOffset)) throw new Error("Invalid projected event.");
      const existing = this.#summaries.get(event.session);
      if (!existing && this.#summaries.size >= 10000) { this.#status = "unavailable"; this.#reason = "storage_full"; return false; }
      const s = existing ?? fresh(event.session);
      if (sourceOffset < s.sourceOffset) throw new Error("Source order regressed.");
      if (sourceOffset === s.sourceOffset && event.kind === "gap") {
        const previous = this.#lastEvents.get(event.session);
        if (previous?.sourceOffset === sourceOffset && previous.kind === "gap" && previous.gapReason === event.gapReason) return true;
      }
      const r = { sourceOffset, event: { ...event, sequence: s.events + 1 } };
      const line = JSON.stringify(r) + "\n"; const bytes = Buffer.byteLength(line);
      if (bytes > MAX_LINE || this.#bytes + bytes > this.maxBytes) { this.#status = "unavailable"; this.#reason = "storage_full"; return false; }
      try {
        const path = join(this.directory, event.session + ".jsonl");
        const info = await lstat(path).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
        if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error();
        await appendFile(path, line, { encoding: "utf8", mode: 0o600, flush: true });
        this.#bytes += bytes; add(s, r); this.#summaries.set(event.session, s);
        this.#lastEvents.set(event.session, { sourceOffset, kind: event.kind, gapReason: event.gapReason });
        if (event.gapReason === "source_truncated") this.#pausedSources.add(event.session);
        return true;
      } catch { this.#status = "unavailable"; this.#reason = "io_error"; return false; }
    });
    this.#queue = task.catch(() => { this.#status = "unavailable"; this.#reason = "invalid_archive"; });
    return task;
  }
  async close(): Promise<void> {
    await this.ready; await this.#queue; this.#closed = true;
    if (this.#ownsLock) { this.#ownsLock = false; await unlink(join(this.directory, "observer.lock")).catch(() => {}); }
  }
}
