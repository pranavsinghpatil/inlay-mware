import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalHistory, MAX_LOCAL_HISTORY_BYTES, type SessionSummary } from "../src/local-history.ts";
import { ObservationAccumulator } from "../src/local-observation.ts";
import type { ExchangeLifecycleSnapshot } from "../src/exchange-lifecycle.ts";

const availableLifecycle: ExchangeLifecycleSnapshot = {
  admitted: 0,
  active: 0,
  forwarding: 0,
  finalized: 0,
  availability: "AVAILABLE",
  incomplete: false,
  unavailableReason: null,
};

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  const timestamp = "2026-10-13T12:00:00.000Z";
  return {
    sessionId: randomUUID(),
    startedAt: timestamp,
    updatedAt: timestamp,
    endedAt: null,
    state: "running",
    totals: new ObservationAccumulator().snapshot(),
    lifecycle: availableLifecycle,
    recurrence: null,
    ...overrides,
  };
}

async function fixture(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "inlay-history-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("saves and reloads aggregate sessions, then closes gracefully", async (t) => {
  const directory = await fixture(t);
  const original = summary({ state: "closed", endedAt: "2026-10-13T12:01:00.000Z" });
  const store = new LocalHistory(directory);
  await store.ready;
  assert.equal(store.snapshot().status, "ready");
  await store.save(original);
  await store.close(original);

  const reloaded = new LocalHistory(directory);
  await reloaded.ready;
  assert.deepEqual(reloaded.snapshot().sessions, [original]);
  await reloaded.close();
});

test("recovers persisted running sessions with an unknown end and no invented end time", async (t) => {
  const directory = await fixture(t);
  const running = summary();
  const first = new LocalHistory(directory);
  await first.ready;
  await first.save(running);
  await first.close();

  const recovered = new LocalHistory(directory);
  await recovered.ready;
  assert.equal(recovered.snapshot().sessions[0]?.state, "end_unknown");
  assert.equal(recovered.snapshot().sessions[0]?.endedAt, null);
  await recovered.close();

  const next = new LocalHistory(directory);
  await next.ready;
  assert.equal(next.snapshot().sessions[0]?.state, "end_unknown");
  assert.equal(next.snapshot().sessions[0]?.endedAt, null);
  await next.close();
});

test("enforces configured session retention", async (t) => {
  const directory = await fixture(t);
  const store = new LocalHistory(directory, 2);
  await store.ready;
  const sessions = [0, 1, 2].map(() => summary({ state: "closed", endedAt: "2026-10-13T12:01:00.000Z" }));
  for (const entry of sessions) await store.save(entry);
  await store.close(sessions[2]);

  const reloaded = new LocalHistory(directory, 2);
  await reloaded.ready;
  assert.deepEqual(reloaded.snapshot().sessions.map((entry) => entry.sessionId), sessions.slice(1).map((entry) => entry.sessionId));
  await reloaded.close();
});

test("lowering retention on reload keeps newest sessions and rewrites the bounded file", async (t) => {
  const directory = await fixture(t);
  const original = new LocalHistory(directory, 3);
  await original.ready;
  const sessions = [0, 1, 2].map((index) => summary({
    state: "closed",
    endedAt: "2026-10-13T12:01:00.000Z",
    updatedAt: new Date(Date.parse("2026-10-13T12:00:00.000Z") + index).toISOString(),
  }));
  for (const entry of sessions) await original.save(entry);
  await original.close(sessions[2]);

  const smaller = new LocalHistory(directory, 2);
  await smaller.ready;
  assert.deepEqual(smaller.snapshot().sessions.map((entry) => entry.sessionId), sessions.slice(-2).map((entry) => entry.sessionId));
  await smaller.close();

  const disk = JSON.parse(await readFile(join(directory, "inlay-history.json"), "utf8")) as { sessions: SessionSummary[] };
  assert.deepEqual(disk.sessions.map((entry) => entry.sessionId), sessions.slice(-2).map((entry) => entry.sessionId));
});

test("rejects oversized history without rewriting it", async (t) => {
  const directory = await fixture(t);
  const path = join(directory, "inlay-history.json");
  const oversized = Buffer.alloc(MAX_LOCAL_HISTORY_BYTES + 1, 0x78);
  await writeFile(path, oversized);

  const store = new LocalHistory(directory);
  await store.ready;
  assert.deepEqual(store.snapshot(), { status: "unavailable", reason: "invalid_history", retentionSessions: 20, sessions: [] });
  assert.deepEqual(await readFile(path), oversized);
  await store.close();
});

test("rejects unknown fields and never echoes or rewrites a sentinel", async (t) => {
  const directory = await fixture(t);
  const path = join(directory, "inlay-history.json");
  const sentinel = "SENTINEL_PRIVATE_RAW_REQUEST_7fe93a";
  const invalid = JSON.stringify({ version: 1, sessions: [], unexpected: sentinel });
  await writeFile(path, invalid);

  const store = new LocalHistory(directory);
  await store.ready;
  const snapshot = store.snapshot();
  assert.equal(snapshot.status, "unavailable");
  assert.equal(snapshot.reason, "invalid_history");
  assert.equal(JSON.stringify(snapshot).includes(sentinel), false);
  assert.equal(await readFile(path, "utf8"), invalid);
  await store.close();
});

test("holds an exclusive empty lock for the store lifetime", async (t) => {
  const directory = await fixture(t);
  const first = new LocalHistory(directory);
  await first.ready;
  assert.deepEqual(await readdir(directory), ["inlay-history.lock"]);
  assert.equal((await readFile(join(directory, "inlay-history.lock"))).byteLength, 0);

  const second = new LocalHistory(directory);
  await second.ready;
  assert.equal(second.snapshot().status, "unavailable");
  assert.equal(second.snapshot().reason, "locked");
  await second.close();
  assert.equal((await readdir(directory)).includes("inlay-history.lock"), true);
  await first.close();
  assert.equal((await readdir(directory)).includes("inlay-history.lock"), false);
});

test("is off without a configured directory and performs no file I/O", async () => {
  const store = new LocalHistory();
  await store.ready;
  assert.deepEqual(store.snapshot(), { status: "off", reason: null, retentionSessions: 20, sessions: [] });
  await store.save(summary());
  await store.close();
});

test("immediate close races rapid saves, preserves final summary, and holds the lock through flush", async (t) => {
  const directory = await fixture(t);
  const store = new LocalHistory(directory);
  await store.ready;
  const id = randomUUID();
  const updates = Array.from({ length: 40 }, (_, index) => summary({
    sessionId: id,
    updatedAt: new Date(Date.parse("2026-10-13T12:00:00.000Z") + index).toISOString(),
  }));
  const pendingSaves = updates.map((entry) => store.save(entry));
  const final = summary({ sessionId: id, state: "closed", endedAt: "2026-10-13T12:01:00.000Z", updatedAt: "2026-10-13T12:01:00.000Z" });
  const closing = store.close(final);
  const contender = new LocalHistory(directory);
  await contender.ready;
  assert.equal(contender.snapshot().reason, "locked");
  await contender.close();
  await Promise.all([...pendingSaves, closing]);

  const persisted = JSON.parse(await readFile(join(directory, "inlay-history.json"), "utf8")) as { sessions: SessionSummary[] };
  assert.deepEqual(persisted.sessions, [final]);
});

test("reports I/O setup failures with a fixed reason and does not throw", async (t) => {
  const directory = join(await fixture(t), "file-not-directory");
  await writeFile(directory, "block");
  const store = new LocalHistory(directory);
  await store.ready;
  assert.equal(store.snapshot().status, "unavailable");
  assert.equal(store.snapshot().reason, "io_error");
  await assert.doesNotReject(store.save(summary()));
  await store.close();
});
