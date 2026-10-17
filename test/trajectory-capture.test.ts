import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { CodexTrajectoryProjector } from "../src/codex-trajectory.ts";
import { CodexTrajectoryReader, sourcePseudonym } from "../src/trajectory-reader.ts";
import { TrajectoryStore } from "../src/trajectory-store.ts";

interface CaptureFixture {
  root: string;
  archive: string;
  source: string;
  store: TrajectoryStore;
  reader: CodexTrajectoryReader;
  key: string;
}

async function fixture(t: TestContext): Promise<CaptureFixture> {
  const base = await mkdtemp(join(tmpdir(), "inlay-trajectory-capture-"));
  t.after(async () => rm(base, { recursive: true, force: true }));
  const root = join(base, "codex", "sessions");
  const archive = join(base, "archive");
  const source = join(root, `${randomUUID()}.jsonl`);
  await mkdir(root, { recursive: true });
  await writeFile(source, "", { mode: 0o600 });
  const store = new TrajectoryStore(archive);
  await store.ready;
  assert.equal(store.status, "ready");
  const reader = new CodexTrajectoryReader(root, store);
  const key = sourcePseudonym(source);
  assert.ok(key);
  t.after(async () => { await reader.close(); await store.close(); });
  return { root, archive, source, store, reader, key };
}

function jsonl(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value) + "\n", "utf8");
}

function turnStarted(id = "RAW_TURN_ID"): object {
  return { timestamp: "2026-10-17T01:00:00.000Z", type: "event_msg", payload: { type: "task_started", turn_id: id, started_at: "2026-10-17T01:00:00.000Z" } };
}

test("captures a UUID-named Codex source as closed metadata and returns no raw values through the store API", async (t) => {
  const f = await fixture(t);
  const canaries = ["RAW_TURN_PRIVATE", "RAW_CALL_PRIVATE", "RAW_ITEM_PRIVATE", "C:\\Users\\private\\workspace", "PRIVATE_COMMAND_ARG", "PRIVATE_OUTPUT_CONTENT"];
  const records = [
    turnStarted(canaries[0]),
    { type: "turn_context", payload: { turn_id: canaries[0], model: "gpt-5.2-codex", effort: "high", cwd: canaries[3] } },
    { type: "response_item", payload: { type: "function_call", call_id: canaries[1], name: "exec_command", arguments: { command: canaries[4], path: canaries[3] } } },
    { type: "event_msg", payload: { type: "item_completed", turn_id: canaries[0], item: {
      id: canaries[2], type: "CommandExecution", command: [canaries[4]], exit_code: 0,
      status: "Completed", aggregated_output: canaries[5],
    } } },
    { type: "response_item", payload: { type: "function_call_output", call_id: canaries[1], output: canaries[5] } },
  ];
  await appendFile(f.source, Buffer.concat(records.map(jsonl)));
  await f.reader.poll();

  const rows = (await f.store.page(f.key)).rows;
  assert.deepEqual(rows.map((row) => row.kind), ["turn_started", "context", "tool_requested", "runtime_action", "tool_result"]);
  assert.equal(rows[0]?.turn, 1);
  assert.equal(rows[2]?.action, rows[4]?.action);
  assert.equal(rows[3]?.category, "command");
  assert.equal(rows[3]?.exitCode, 0);
  assert.equal(rows[3]?.outcome, "reported_success");

  const saved = await readFile(join(f.archive, `${f.key}.jsonl`), "utf8");
  assert.equal((await readdir(f.archive)).includes("observer.lock"), true);
  for (const secret of canaries) assert.equal(saved.includes(secret), false, secret);
  const api = JSON.stringify({ summary: f.store.snapshot(), page: await f.store.page(f.key) });
  for (const secret of canaries) assert.equal(api.includes(secret), false, secret);
});

test("holds partial JSON across append boundaries, including a split UTF-8 code point and reads beyond 64 KiB", async (t) => {
  const f = await fixture(t);
  const start = jsonl(turnStarted("TURN_MULTIBYTE"));
  await appendFile(f.source, start);

  const prefixRecord = { type: "response_item", payload: { type: "function_call", call_id: "CALL_BIG", name: "exec_command", arguments: { command: "" } } };
  const emptyLine = Buffer.from(JSON.stringify(prefixRecord), "utf8");
  const inputStart = emptyLine.indexOf(Buffer.from("\"\"", "utf8")) + 1;
  const absoluteTargetEmojiByte = 65_535;
  const paddingLength = absoluteTargetEmojiByte - start.length - inputStart;
  assert.ok(paddingLength > 0);
  const longRecord = { ...prefixRecord, payload: { ...prefixRecord.payload, arguments: { command: `${"x".repeat(paddingLength)}🦊${"z".repeat(50_000)}` } } };
  const line = Buffer.from(JSON.stringify(longRecord), "utf8");
  const emojiAt = line.indexOf(Buffer.from("🦊", "utf8"));
  assert.equal(start.length + emojiAt, absoluteTargetEmojiByte);
  const splitOffset = 65_536 - start.length;
  assert.ok(splitOffset < line.length);
  await appendFile(f.source, line.subarray(0, splitOffset));
  await f.reader.poll();
  assert.equal((await f.store.page(f.key)).rows.length, 1, "unterminated JSON must not be projected");
  assert.equal(f.reader.snapshot().partialLineSources, 1);

  await appendFile(f.source, Buffer.concat([line.subarray(splitOffset), Buffer.from("\n", "utf8")]));
  await f.reader.poll();
  const rows = (await f.store.page(f.key)).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.kind, "tool_requested");
  assert.equal(rows[1]?.inputBytes, Buffer.byteLength(JSON.stringify({ command: `${"x".repeat(paddingLength)}🦊${"z".repeat(50_000)}` })));
  assert.equal(f.reader.snapshot().partialLineSources, 0);
});

test("replays saved prefixes into transient correlation state without duplicating events", async (t) => {
  const f = await fixture(t);
  const request = { type: "response_item", payload: { type: "function_call", call_id: "REPLAY_CALL", name: "exec_command", arguments: { command: "private" } } };
  const prefix = Buffer.concat([jsonl(turnStarted("REPLAY_TURN")), jsonl(request)]);
  await appendFile(f.source, prefix);
  await f.reader.poll();
  const savedBeforeRestart = (await f.store.page(f.key)).rows;
  assert.equal(savedBeforeRestart.length, 2);
  const originalAction = savedBeforeRestart[1]?.action;
  await f.reader.close();
  await f.store.close();

  const store = new TrajectoryStore(f.archive);
  await store.ready;
  const reader = new CodexTrajectoryReader(f.root, store);
  t.after(async () => { await reader.close(); await store.close(); });
  await appendFile(f.source, jsonl({ type: "response_item", payload: { type: "function_call_output", call_id: "REPLAY_CALL", output: "private result" } }));
  await reader.poll();

  const rows = (await store.page(f.key)).rows;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.sequence), [1, 2, 3]);
  assert.equal(rows[1]?.action, originalAction);
  assert.equal(rows[2]?.action, originalAction);
  assert.equal(rows[1]?.turn, 1);
  assert.equal(rows[2]?.turn, 1);
});

test("opens context-only turns and retains explicit gaps or missing measurements", async (t) => {
  const f = await fixture(t);
  const records = [
    { type: "turn_context", payload: { turn_id: "CONTEXT_ONLY_TURN", model: "gpt-6-sol" } },
    { type: "response_item", payload: { type: "function_call", call_id: "CONTEXT_ONLY_CALL", name: "exec_command", arguments: [] } },
    { type: "response_item", payload: { type: "function_call_output", output: "PRIVATE_ORPHAN_OUTPUT" } },
    { type: "event_msg", payload: { type: "item_completed", item: { type: "FileChange", status: "Completed" } } },
  ];
  await appendFile(f.source, Buffer.concat(records.map(jsonl)));
  await f.reader.poll();
  const rows = (await f.store.page(f.key)).rows;
  assert.equal(rows[0]?.turn, 1);
  assert.equal(rows[1]?.turn, 1);
  assert.equal(rows[2]?.kind, "gap");
  assert.equal(rows[2]?.gapReason, "malformed_record");
  assert.equal(rows[3]?.changedFiles, null);
  const archive = await readFile(join(f.archive, `${f.key}.jsonl`), "utf8");
  assert.equal(archive.includes("PRIVATE_ORPHAN_OUTPUT"), false);
});

test("honors a validated explicit turn ID when multiple turns are active", async (t) => {
  const f = await fixture(t);
  const records = [
    turnStarted("ACTIVE_TURN_A"),
    { type: "event_msg", payload: { type: "task_started", turn_id: "ACTIVE_TURN_B" } },
    { type: "response_item", payload: { type: "function_call", call_id: "EXPLICIT_A", turn_id: "ACTIVE_TURN_A", name: "exec_command", arguments: [] } },
    { type: "response_item", payload: { type: "function_call", call_id: "NO_GUESS", name: "exec_command", arguments: [] } },
    { type: "response_item", payload: { type: "function_call", call_id: "INVALID_EXPLICIT", turn_id: 3, name: "exec_command", arguments: [] } },
  ];
  await appendFile(f.source, Buffer.concat(records.map(jsonl)));
  await f.reader.poll();
  const rows = (await f.store.page(f.key)).rows;
  assert.equal(rows[2]?.turn, 1);
  assert.equal(rows[3]?.turn, null);
  assert.equal(rows[4]?.turn, null, "an invalid explicit ID must not fall back to an active turn");
});

test("records malformed and overlong JSONL rows as fixed gap metadata", async (t) => {
  const f = await fixture(t);
  const raw = Buffer.concat([
    Buffer.from("{broken PRIVATE_MALFORMED}\n", "utf8"),
    Buffer.from(JSON.stringify({ type: "event_msg", payload: { type: "ignored", secret: "PRIVATE_OVERSIZE" } }).replace("PRIVATE_OVERSIZE", "x".repeat(300_000)) + "\n", "utf8"),
  ]);
  await appendFile(f.source, raw);
  await f.reader.poll();
  const rows = (await f.store.page(f.key)).rows;
  assert.deepEqual(rows.map((row) => [row.kind, row.gapReason]), [
    ["gap", "malformed_record"], ["gap", "oversize_record"],
  ]);
  const disk = await readFile(join(f.archive, `${f.key}.jsonl`), "utf8");
  assert.equal(disk.includes("PRIVATE_MALFORMED"), false);
  assert.equal(disk.includes("PRIVATE_OVERSIZE"), false);
});

test("pauses a source after truncation and keeps a source_truncated gap", async (t) => {
  const f = await fixture(t);
  await appendFile(f.source, jsonl(turnStarted("TRUNCATED_TURN")));
  await f.reader.poll();
  assert.equal((await f.store.page(f.key)).rows.length, 1);
  await truncate(f.source, 0);
  await f.reader.poll();
  assert.equal(f.reader.snapshot().pausedSources, 1);
  assert.equal((await f.store.page(f.key)).rows.at(-1)?.gapReason, "source_truncated");
  await appendFile(f.source, jsonl(turnStarted("SHOULD_NOT_RESUME")));
  await f.reader.poll();
  assert.equal((await f.store.page(f.key)).rows.length, 2);

  await f.reader.close();
  await f.store.close();
  const store = new TrajectoryStore(f.archive);
  await store.ready;
  const reader = new CodexTrajectoryReader(f.root, store);
  t.after(async () => { await reader.close(); await store.close(); });
  await reader.poll();
  assert.equal((await store.page(f.key)).rows.length, 2, "restart must not duplicate the truncation gap");
});

test("reports exclusive store-lock collision without releasing another store's lock", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "inlay-trajectory-lock-"));
  t.after(async () => rm(base, { recursive: true, force: true }));
  const first = new TrajectoryStore(base);
  await first.ready;
  const second = new TrajectoryStore(base);
  await second.ready;
  assert.equal(first.snapshot().status, "ready");
  assert.deepEqual({ status: second.snapshot().status, reason: second.snapshot().reason }, { status: "unavailable", reason: "locked" });
  await second.close();
  assert.deepEqual(await readdir(base), ["observer.lock"]);
  await first.close();
  assert.deepEqual(await readdir(base), []);
});

test("storage exhaustion retains previously saved events without eviction", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "inlay-trajectory-full-"));
  t.after(async () => rm(base, { recursive: true, force: true }));
  const store = new TrajectoryStore(base, 4096);
  await store.ready;
  const projector = new CodexTrajectoryProjector("abcdef0123456789abcdef0123456789");
  const first = projector.accept({ type: "event_msg", payload: { type: "task_started", turn_id: "KEEP" } })!;
  assert.equal(await store.append(first, 10), true);
  let offset = 11;
  let saved = 1;
  while (store.status === "ready") {
    const appended = await store.append(projector.gap("io_error"), offset++);
    if (!appended) break;
    saved++;
  }
  assert.equal(store.snapshot().reason, "storage_full");
  const page = await store.page(first.session);
  assert.equal(page.rows.length, saved);
  assert.equal(page.rows[0]?.kind, "turn_started");
  assert.equal(page.rows[0]?.sequence, 1);
  assert.equal(await store.append(projector.gap("io_error"), offset), false);
  assert.equal((await store.page(first.session)).rows.length, saved);
  await store.close();
});

test("marks torn persisted archives unavailable and preserves the bytes for inspection", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "inlay-trajectory-torn-"));
  t.after(async () => rm(base, { recursive: true, force: true }));
  const key = "abcdef0123456789abcdef0123456789";
  const store = new TrajectoryStore(base);
  await store.ready;
  const event = new CodexTrajectoryProjector(key).accept({ type: "event_msg", payload: { type: "task_started", turn_id: "SAFE" } })!;
  assert.equal(await store.append(event, 1), true);
  await store.close();
  const path = join(base, `${key}.jsonl`);
  const torn = Buffer.from("{\"partial\":", "utf8");
  await appendFile(path, torn);
  const before = await readFile(path);
  const recovered = new TrajectoryStore(base);
  await recovered.ready;
  assert.equal(recovered.snapshot().status, "unavailable");
  assert.equal(recovered.snapshot().reason, "invalid_archive");
  assert.deepEqual(await readFile(path), before);
  await recovered.close();
});

test("continues source discovery after skipping a symlink directory", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "inlay-trajectory-discovery-"));
  t.after(async () => rm(base, { recursive: true, force: true }));
  const root = join(base, "codex");
  const good = join(root, "01-good");
  const target = join(base, "outside");
  const archive = join(base, "archive");
  await mkdir(good, { recursive: true });
  await mkdir(target, { recursive: true });
  await writeFile(join(good, `${randomUUID()}.jsonl`), jsonl(turnStarted("SAFE")));
  try {
    await symlink(target, join(root, "00-link"), "junction");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") return t.skip("symlink creation is unavailable in this environment");
    throw error;
  }
  const store = new TrajectoryStore(archive);
  await store.ready;
  const reader = new CodexTrajectoryReader(root, store);
  t.after(async () => { await reader.close(); await store.close(); });
  await reader.poll();
  assert.equal(reader.snapshot().discoveredSources, 1);
  assert.equal(reader.snapshot().discoveryLimited, true);
});

test("reports duplicate UUID pseudonyms at different paths without merging sources", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "inlay-trajectory-duplicate-source-"));
  t.after(async () => rm(base, { recursive: true, force: true }));
  const root = join(base, "codex");
  const first = join(root, "00-first");
  const second = join(root, "01-second");
  const archive = join(base, "archive");
  const sessionName = `${randomUUID()}.jsonl`;
  await mkdir(first, { recursive: true });
  await mkdir(second, { recursive: true });
  await writeFile(join(first, sessionName), jsonl(turnStarted("FIRST_PRIVATE")));
  await writeFile(join(second, sessionName), jsonl(turnStarted("SECOND_PRIVATE")));
  const store = new TrajectoryStore(archive);
  await store.ready;
  const reader = new CodexTrajectoryReader(root, store);
  t.after(async () => { await reader.close(); await store.close(); });
  await reader.poll();
  assert.equal(reader.snapshot().discoveredSources, 1);
  assert.equal(reader.snapshot().duplicateSources, 1);
  assert.equal(reader.snapshot().discoveryLimited, true);
  const key = sourcePseudonym(sessionName)!;
  const rows = (await store.page(key)).rows;
  assert.equal(rows.length, 1, "duplicate paths must not be combined under one pseudonym");
  const disk = await readFile(join(archive, `${key}.jsonl`), "utf8");
  assert.equal(disk.includes("FIRST_PRIVATE"), false);
  assert.equal(disk.includes("SECOND_PRIVATE"), false);
});

test("paged archive tails follow newly appended events without losing historical pages", async t => {
  const f = await fixture(t);
  const projector = new CodexTrajectoryProjector(f.key);
  for (let i = 1; i <= 405; i++) {
    const e = projector.accept({type:"turn_context",payload:{turn_id:"synthetic",model:"gpt-6.1-sol"}});
    assert(e);assert(await f.store.append(e,i));
  }
  const first = await f.store.page(f.key);
  assert.equal(first.rows.length,200);assert.equal(first.next,200);
  const tail = await f.store.page(f.key,0,true);
  assert.equal(tail.rows[0].sequence,206);assert.equal(tail.rows.at(-1)!.sequence,405);assert.equal(tail.next,null);
  const e=projector.accept({type:"turn_context",payload:{turn_id:"synthetic",model:"gpt-6.1-sol"}});assert(e);
  assert(await f.store.append(e,406));
  const latest=await f.store.page(f.key,0,true);
  assert.equal(latest.rows[0].sequence,207);assert.equal(latest.rows.at(-1)!.sequence,406);
});
