import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { CodexTrajectoryProjector, type TrajectoryEvent } from "./codex-trajectory.ts";
import { TrajectoryStore } from "./trajectory-store.ts";

const READ_CHUNK = 64 * 1024;
const SOURCE_SLICE = 512 * 1024;
const TICK_BYTES = 8 * 1024 * 1024;
const MAX_LINE = 256 * 1024;
const MAX_SOURCES = 10000;
export function sourcePseudonym(name: string): string | null {
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(basename(name));
  return match ? createHash("sha256").update("inlay-codex-trajectory-v1\0" + match[1].toLowerCase()).digest("hex").slice(0, 32) : null;
}
interface Source {
  path: string; key: string; offset: number; completeOffset: number; savedOffset: number;
  pending: Buffer; discarding: boolean; projector: CodexTrajectoryProjector;
  disabled: boolean; caughtUp: boolean; identity: string | null;
}

/** Reads existing Codex files transiently; never writes to them or exports their paths. */
export class CodexTrajectoryReader {
  #root: string;
  #store: TrajectoryStore;
  #sources = new Map<string, Source>();
  #running: Promise<void> | null = null;
  #cursor = 0;
  #lastDiscovery = 0;
  #discoveryUnavailable = false;
  #discoveryLimited = false;
  #scanLimitReached = false;
  #duplicateSources = 0;
  #unsupportedNames = 0;
  #sourceRecords = 0;
  #ignoredRecords = 0;
  #stopped = false;
  constructor(root: string, store: TrajectoryStore) { this.#root = resolve(root); this.#store = store; }
  snapshot() {
    const states = [...this.#sources.values()];
    return { source: "codex_local_records", discoveredSources: states.length,
      catchingUp: states.filter(s => !s.caughtUp && !s.disabled).length,
      pausedSources: states.filter(s => s.disabled).length,
      partialLineSources: states.filter(s => s.pending.length > 0 || s.discarding).length,
      discoveryUnavailable: this.#discoveryUnavailable, discoveryLimited: this.#discoveryLimited,
      unsupportedSourceNames: this.#unsupportedNames, duplicateSources: this.#duplicateSources, sourceRecordsRead: this.#sourceRecords,
      ignoredSourceRecords: this.#ignoredRecords, stopped: this.#stopped,
      taskVerification: "unavailable", proxyExchangeJoin: "unavailable", semanticToolQuality: "unavailable" };
  }
  poll(): Promise<void> {
    if (this.#running) return this.#running;
    this.#running = this.#poll().finally(() => { this.#running = null; });
    return this.#running;
  }
  async #discover(): Promise<void> {
    this.#discoveryUnavailable = false; this.#discoveryLimited = false; this.#scanLimitReached = false; this.#unsupportedNames = 0; this.#duplicateSources = 0;
    try {
      const root = await lstat(this.#root);
      if (!root.isDirectory() || root.isSymbolicLink()) throw new Error();
      const canonicalRoot = await realpath(this.#root);
      let inspected = 0;
      const walk = async (directory: string, depth: number): Promise<void> => {
        if (depth > 4) { this.#discoveryLimited = true; return; }
        if (this.#scanLimitReached) return;
        const entries = await readdir(directory, { withFileTypes: true });
        entries.sort((a,b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (++inspected > 50000) { this.#discoveryLimited = true; this.#scanLimitReached = true; return; }
          if (entry.isSymbolicLink()) { this.#discoveryLimited = true; continue; }
          const path = join(directory, entry.name);
          if (entry.isDirectory()) { await walk(path, depth + 1); continue; }
          if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
          const key = sourcePseudonym(entry.name);
          if (!key) { this.#unsupportedNames++; continue; }
          const previous = this.#sources.get(key);
          if (previous) {
            if (resolve(previous.path) !== resolve(path)) { this.#duplicateSources++; this.#discoveryLimited = true; }
            continue;
          }
          if (this.#sources.size >= MAX_SOURCES) { this.#discoveryLimited = true; this.#scanLimitReached = true; return; }
          const canonical = await realpath(path);
          if (!canonical.startsWith(canonicalRoot + sep)) { this.#discoveryLimited = true; continue; }
          this.#sources.set(key, { path, key, offset: 0, completeOffset: 0,
            savedOffset: this.#store.checkpoint(key), pending: Buffer.alloc(0), discarding: false,
            projector: new CodexTrajectoryProjector(key), disabled: this.#store.isPaused(key), caughtUp: false, identity: null });
        }
      };
      await walk(this.#root, 0);
    } catch { this.#discoveryUnavailable = true; }
  }
  async #poll(): Promise<void> {
    await this.#store.ready;
    if (this.#stopped || this.#store.status !== "ready") return;
    if (Date.now() - this.#lastDiscovery >= 5000) { await this.#discover(); this.#lastDiscovery = Date.now(); }
    const sources = [...this.#sources.values()]; if (!sources.length) return;
    let bytes = 0;
    for (let n = 0; n < sources.length && bytes < TICK_BYTES && !this.#stopped; n++) {
      const source = sources[this.#cursor++ % sources.length];
      if (source.disabled) continue;
      bytes += await this.#read(source, Math.min(SOURCE_SLICE, TICK_BYTES - bytes));
      if (this.#store.status !== "ready") break;
    }
  }
  async #persist(source: Source, event: TrajectoryEvent | null, offset: number): Promise<void> {
    if (event && offset > source.savedOffset) {
      if (!await this.#store.append(event, offset)) throw new Error();
      source.savedOffset = offset;
    }
  }
  async #read(source: Source, allowance: number): Promise<number> {
    let consumed = 0;
    try {
      const info = await lstat(source.path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error();
      const rootInfo = await lstat(this.#root);
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error();
      const canonicalRoot = await realpath(this.#root);
      const canonicalSource = await realpath(source.path);
      if (!canonicalSource.startsWith(canonicalRoot + sep)) throw new Error();
      const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
      if (info.size < Math.max(source.offset, source.savedOffset) || (source.identity !== null && source.identity !== identity)) {
        await this.#store.append(source.projector.gap("source_truncated"), source.savedOffset);
        source.disabled = true; return 0;
      }
      source.identity = identity;
      const h = await open(source.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      let readSize = info.size;
      try {
        const openedInfo = await h.stat();
        if (!openedInfo.isFile() || openedInfo.dev !== info.dev || openedInfo.ino !== info.ino) throw new Error();
        if (openedInfo.size < Math.max(source.offset, source.savedOffset) || openedInfo.size < info.size) {
          await this.#store.append(source.projector.gap("source_truncated"), source.savedOffset);
          source.disabled = true; return 0;
        }
        readSize = openedInfo.size;
        const buffer = Buffer.alloc(READ_CHUNK);
        while (source.offset < openedInfo.size && consumed < allowance && !this.#stopped) {
          const { bytesRead } = await h.read(buffer, 0, Math.min(buffer.length, allowance - consumed, openedInfo.size - source.offset), source.offset);
          if (!bytesRead) break;
          consumed += bytesRead;
          const chunk = buffer.subarray(0, bytesRead); let start = 0;
          for (let i = 0; i < bytesRead; i++) if (chunk[i] === 10) {
            const segment = chunk.subarray(start, i); const endOffset = source.offset + i + 1;
            let event: TrajectoryEvent | null = null;
            if (source.discarding || source.pending.length + segment.length > MAX_LINE) {
              event = source.projector.gap("oversize_record");
            } else {
              const line = Buffer.concat([source.pending, segment]);
              if (line.length) {
                this.#sourceRecords++;
                try {
                  const text = new TextDecoder("utf-8", { fatal: true }).decode(line);
                  event = source.projector.accept(JSON.parse(text));
                  if (event === null) this.#ignoredRecords++;
                } catch { event = source.projector.gap("malformed_record"); }
              }
            }
            await this.#persist(source, event, endOffset);
            source.completeOffset = endOffset; source.pending = Buffer.alloc(0); source.discarding = false; start = i + 1;
          }
          const rest = chunk.subarray(start);
          if (!source.discarding && source.pending.length + rest.length <= MAX_LINE) source.pending = Buffer.concat([source.pending, rest]);
          else { source.pending = Buffer.alloc(0); source.discarding = true; }
          source.offset += bytesRead;
        }
      } finally { await h.close(); }
      source.caughtUp = source.offset >= readSize;
    } catch {
      source.disabled = true;
      if (this.#store.status === "ready") await this.#store.append(source.projector.gap("io_error"), source.savedOffset);
    }
    return consumed;
  }
  async close(): Promise<void> {
    this.#stopped = true; await this.#running;
    for (const s of this.#sources.values()) if ((s.pending.length || s.discarding) && this.#store.status === "ready") {
      await this.#store.append(s.projector.gap("incomplete_tail"), s.savedOffset);
    }
  }
}
