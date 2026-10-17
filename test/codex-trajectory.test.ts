import assert from "node:assert/strict";
import test from "node:test";
import { CodexTrajectoryProjector, isTrajectoryEvent } from "../src/codex-trajectory.ts";

const sourceKey = "0123456789abcdef0123456789abcdef";

function makeProjector(): CodexTrajectoryProjector {
  return new CodexTrajectoryProjector(sourceKey);
}

test("projects turn lifecycle without treating agent completion as verified success", () => {
  const projector = makeProjector();
  const started = projector.accept({ timestamp: "2026-10-17T00:00:00.000Z", type: "event_msg", payload: { type: "task_started", turn_id: "PRIVATE_TURN" } });
  const finished = projector.accept({ timestamp: "2026-10-17T00:00:01.500Z", type: "event_msg", payload: { type: "task_complete", turn_id: "PRIVATE_TURN", duration_ms: 1500, last_agent_message: "PRIVATE_RESULT" } });
  assert.equal(started?.kind, "turn_started");
  assert.equal(finished?.kind, "turn_finished");
  assert.equal(finished?.outcome, "unknown");
  assert.equal(finished?.evidence, "agent_reported_completion");
  assert.equal(finished?.durationMs, 1500);
  assert.equal(finished?.elapsedMs, 1500);
  assert.equal(JSON.stringify([started, finished]).includes("PRIVATE_"), false);
});

test("joins interleaved tool calls by transient IDs and records only byte counts", () => {
  const projector = makeProjector();
  const first = projector.accept({ type: "response_item", payload: { type: "function_call", call_id: "SECRET_CALL_A", name: "exec_command", arguments: { command: "PRIVATE_COMMAND" } } });
  const second = projector.accept({ type: "response_item", payload: { type: "custom_tool_call", call_id: "SECRET_CALL_B", namespace: "mcp__private_connector", input: "PRIVATE_INPUT" } });
  const resultB = projector.accept({ type: "response_item", payload: { type: "custom_tool_call_output", call_id: "SECRET_CALL_B", output: [{ type: "text", text: "PRIVATE_OUTPUT" }] } });
  const resultA = projector.accept({ type: "response_item", payload: { type: "function_call_output", call_id: "SECRET_CALL_A", output: "success PRIVATE_OUTPUT" } });

  assert.equal(first?.kind, "tool_requested");
  assert.equal(first?.category, "exec");
  assert.equal(first?.inputBytes, Buffer.byteLength(JSON.stringify({ command: "PRIVATE_COMMAND" })));
  assert.equal(second?.category, "connector");
  assert.equal(resultB?.action, second?.action);
  assert.equal(resultA?.action, first?.action);
  assert.equal(resultA?.outcome, "unknown", "tool output text is never parsed as a success signal");
  assert.equal(resultA?.outputBytes, Buffer.byteLength(JSON.stringify("success PRIVATE_OUTPUT")));
  assert.equal(JSON.stringify([first, second, resultB, resultA]).includes("SECRET_CALL"), false);
  assert.equal(JSON.stringify([first, second, resultB, resultA]).includes("PRIVATE_"), false);
});

test("projects structured runtime command and file change reports without paths or source text", () => {
  const projector = makeProjector();
  const command = projector.accept({
    type: "event_msg",
    payload: { type: "item_completed", turn_id: "TURN_SECRET", started_at_ms: 1000, completed_at_ms: 3500, item: {
      id: "RUNTIME_SECRET", type: "CommandExecution", command: ["PRIVATE_COMMAND"], status: "Completed", exit_code: 7,
      parsed_cmd: [{ type: "command", command: "PRIVATE_COMMAND" }], aggregated_output: "PRIVATE_LOG",
    } },
  });
  const changed = projector.accept({
    type: "event_msg",
    payload: { type: "item_completed", turn_id: "TURN_SECRET", item: {
      id: "FILE_SECRET", type: "FileChange", changes: { "PRIVATE_PATH": { diff: "PRIVATE_SOURCE" }, "OTHER_PATH": {} }, status: "Completed",
    } },
  });
  assert.equal(command?.category, "command");
  assert.equal(command?.outcome, "reported_failure");
  assert.equal(command?.evidence, "runtime_exit_code");
  assert.equal(command?.exitCode, 7);
  assert.equal(command?.durationMs, 2500);
  assert.equal(command?.elapsedMs, 0);
  assert.equal(changed?.category, "file_change");
  assert.equal(changed?.changedFiles, 2);
  assert.equal(changed?.outcome, "reported_success");
  assert.equal(JSON.stringify([command, changed]).match(/PRIVATE_|RUNTIME_SECRET|FILE_SECRET/g), null);
});

test("keeps model names closed, validates exact event shape, and emits monotone sequence", () => {
  const projector = makeProjector();
  const known = projector.accept({ type: "turn_context", payload: { turn_id: "T", model: "gpt-5.2-codex", effort: "HIGH" } });
  const unknown = projector.accept({ type: "turn_context", payload: { turn_id: "T", model: "model-secret-123", effort: "private-effort" } });
  assert.equal(known?.model, "gpt-5.2-codex");
  assert.equal(known?.reasoningEffort, "high");
  assert.equal(unknown?.model, "other");
  assert.equal(unknown?.reasoningEffort, null);
  assert.equal(unknown?.sequence, (known?.sequence ?? 0) + 1);
  assert.equal(isTrajectoryEvent(known), true);
  assert.equal(isTrajectoryEvent({ ...known, model: "model-secret-123" }), false);
  assert.equal(isTrajectoryEvent({ ...known, extra: "payload" }), false);
});

test("handles missing exit evidence and duplicate runtime completion conservatively", () => {
  const projector = makeProjector();
  const record = { type: "event_msg", payload: { type: "item_completed", item: { id: "ONCE", type: "CommandExecution", status: "Completed" } } };
  const event = projector.accept(record);
  assert.equal(event?.outcome, "unknown");
  assert.equal(event?.evidence, null);
  assert.equal(projector.accept(record), null);
});

test("associates tools only with one active turn and keeps that turn through interleaving", () => {
  const projector = makeProjector();
  projector.accept({ type: "event_msg", payload: { type: "task_started", turn_id: "TURN_A" } });
  const requestA = projector.accept({ type: "response_item", payload: { type: "function_call", call_id: "CALL_A", name: "exec_command", arguments: [] } });
  projector.accept({ type: "event_msg", payload: { type: "task_started", turn_id: "TURN_B" } });
  const requestAmbiguous = projector.accept({ type: "response_item", payload: { type: "function_call", call_id: "CALL_B", name: "exec_command", arguments: [] } });
  const resultA = projector.accept({ type: "response_item", payload: { type: "function_call_output", call_id: "CALL_A", output: "" } });
  assert.equal(requestA?.turn, 1);
  assert.equal(requestAmbiguous?.turn, null);
  assert.equal(resultA?.turn, requestA?.turn);
  assert.equal(resultA?.action, requestA?.action);
});

test("keeps orphan tool results visible and separates agent activity from runtime actions", () => {
  const projector = makeProjector();
  const orphan = projector.accept({ type: "response_item", payload: { type: "function_call_output", call_id: "MISSING_CALL", output: "PRIVATE_OUTPUT" } });
  const activity = projector.accept({ type: "event_msg", payload: { type: "item_completed", item: { id: "MESSAGE_ID", type: "AgentMessage", text: "PRIVATE_MESSAGE" } } });
  assert.equal(orphan?.kind, "tool_result");
  assert.equal(orphan?.action, null);
  assert.equal(orphan?.category, "other");
  assert.equal(orphan?.outcome, "unknown");
  assert.equal(activity?.kind, "agent_activity");
  assert.equal(activity?.category, "message");
  assert.equal(JSON.stringify([orphan, activity]).includes("PRIVATE_"), false);
});

test("maps generic exec wrappers as orchestration and rejects duplicate pending call IDs", () => {
  const projector = makeProjector();
  const request = projector.accept({ type: "response_item", payload: { type: "custom_tool_call", call_id: "SAME_ID", name: "exec", namespace: "mcp__codex" } });
  const duplicate = projector.accept({ type: "response_item", payload: { type: "custom_tool_call", call_id: "SAME_ID", name: "exec", namespace: "mcp__codex" } });
  assert.equal(request?.category, "orchestration");
  assert.equal(duplicate?.kind, "gap");
  assert.equal(duplicate?.gapReason, "malformed_record");
});

test("represents malformed and oversized source records as fixed gap events", () => {
  const projector = makeProjector();
  const malformed = projector.accept("PRIVATE_RAW_RECORD");
  const oversize = projector.accept({ type: "event_msg", payload: { type: "ignored", giant: "x".repeat(300_000) } });
  assert.equal(malformed?.kind, "gap");
  assert.equal(malformed?.gapReason, "malformed_record");
  assert.equal(oversize?.kind, "gap");
  assert.equal(oversize?.gapReason, "oversize_record");
  assert.equal(JSON.stringify([malformed, oversize]).includes("PRIVATE_RAW_RECORD"), false);
});

test("bounds transient correlation state and reports a fixed state limit gap", () => {
  const projector = makeProjector();
  let last = null;
  for (let i = 0; i < 4097; i += 1) {
    last = projector.accept({ type: "response_item", payload: { type: "function_call", call_id: `PRIVATE_${i}`, name: "exec_command", arguments: "" } });
  }
  assert.equal(last?.kind, "gap");
  assert.equal(last?.gapReason, "state_limit");
  assert.equal(JSON.stringify(last).includes("PRIVATE_"), false);
});

test("rejects invalid source pseudonyms and preserves timestamp regressions as unknown elapsed time", () => {
  assert.throws(() => new CodexTrajectoryProjector("PRIVATE_SOURCE"), /sourceKey/);
  const projector = makeProjector();
  const first = projector.accept({ timestamp: "2026-10-17T00:00:02.000Z", type: "turn_context", payload: { turn_id: "T", model: "gpt-6-sol" } });
  const regressed = projector.accept({ timestamp: "2026-10-17T00:00:01.000Z", type: "turn_context", payload: { turn_id: "T", model: "gpt-6-sol" } });
  assert.equal(first?.elapsedMs, 0);
  assert.equal(regressed?.elapsedMs, null);
});
