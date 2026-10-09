import assert from "node:assert/strict";
import test from "node:test";
import { calibrate, readArtifacts, validateSchema, verifyFreeze } from "../research/evidence-readiness/v1/calibrate.ts";
import { assignments, scorePilot, type Response } from "../research/evidence-readiness/v1/scoring.ts";

test("research artifacts have a valid freeze, exactly 24 unique cards, and a strict content-free schema", async () => {
  await verifyFreeze();
  const { cards, answers, schema } = await readArtifacts();
  assert.equal(cards.length, 24);
  assert.equal(answers.length, 24);
  const withRawField = structuredClone(cards);
  (withRawField[0].measurements as Record<string, unknown>).rawBody = "synthetic prohibited field";
  assert.throws(() => validateSchema(withRawField, schema));
  const withUnknownValue = structuredClone(cards);
  withUnknownValue[0].measurements.encoding = "unexpected encoding scalar";
  assert.throws(() => validateSchema(withUnknownValue, schema));
  const withNegativeCount = structuredClone(cards);
  withNegativeCount[0].measurements.inputItems = -1;
  assert.throws(() => validateSchema(withNegativeCount, schema));
});

test("research fixtures match frozen measurements and selected checks without predicting classifications", async () => {
  const report = await calibrate();
  assert.equal(report.status, "PASS", "a research fixture or frozen expectation failed");
  assert.equal(report.caseCount, 24);
  assert.deepEqual(report.classificationCounts, { SUPPORTED: 6, PARTIAL: 6, UNAVAILABLE: 6, UNKNOWN_MUST_ABSTAIN: 6 });
  assert.ok(report.cases.every((entry) => entry.measurementMatch && entry.checks.every((check) => check.passed)));
  assert.ok(report.cases.filter((entry) => entry.id >= "C19").every((entry) => entry.classification === "UNKNOWN_MUST_ABSTAIN"));
  assert.equal(report.liveRuns, 0);
  assert.equal(report.participantRuns, 0);
  assert.equal(report.productionReportImplemented, false);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /requestId|startedAt|authorization|rawBody|data:|event:|[A-Fa-f0-9]{64}/);
});

async function syntheticResponses() {
  const { answers } = await readArtifacts();
  const responses: Response[] = assignments(answers).map((assignment) => ({
    ...assignment, decision: answers.find((answer) => answer.id === assignment.id)!.classification, elapsedSeconds: 60,
  }));
  return { answers, responses };
}

test("pilot assignment has 12 presentations per arm per participant and every case in both formats", async () => {
  const { answers } = await readArtifacts();
  const schedule = assignments(answers);
  for (const participant of [1, 2, 3]) {
    assert.equal(schedule.filter((entry) => entry.participant === participant && entry.format === "control").length, 12);
    assert.equal(schedule.filter((entry) => entry.participant === participant && entry.format === "treatment").length, 12);
  }
  for (const answer of answers) {
    assert.ok(schedule.some((entry) => entry.id === answer.id && entry.format === "control"));
    assert.ok(schedule.some((entry) => entry.id === answer.id && entry.format === "treatment"));
  }
});

test("pilot usefulness threshold requires eight net correct answers, not seven, out of 36 per arm", async () => {
  const { answers, responses } = await syntheticResponses();
  const controls = responses.filter((entry) => entry.format === "control");
  for (const entry of controls.slice(0, 7)) entry.decision = null;
  const seven = scorePilot(responses, answers);
  assert.equal(seven.netAdditionalCorrect, 7);
  assert.equal(seven.usefulnessGatePassed, false);
  controls[7].decision = null;
  const eight = scorePilot(responses, answers);
  assert.equal(eight.netAdditionalCorrect, 8);
  assert.equal(eight.controlCount, 36);
  assert.equal(eight.treatmentCount, 36);
  assert.equal(eight.usefulnessGatePassed, true);
  assert.ok(eight.pooledGainPercentagePoints > 20);
});

test("pilot scoring rejects false supported answers and cannot pass by universal abstention", async () => {
  const { answers, responses } = await syntheticResponses();
  for (const entry of responses.filter((response) => response.format === "control").slice(0, 10)) entry.decision = null;
  const unsafe = responses.find((response) => response.format === "treatment" && answers.find((answer) => answer.id === response.id)!.classification !== "SUPPORTED")!;
  unsafe.decision = "SUPPORTED";
  const scored = scorePilot(responses, answers);
  assert.equal(scored.treatmentFalseSupported, 1);
  assert.equal(scored.usefulnessGatePassed, false);
  for (const entry of responses) entry.decision = "UNKNOWN_MUST_ABSTAIN";
  assert.equal(scorePilot(responses, answers).usefulnessGatePassed, false);
  for (const entry of responses) entry.decision = entry.format === "treatment" && answers.find((answer) => answer.id === entry.id)!.classification === "SUPPORTED" ? "SUPPORTED" : null;
  const noNegativeDecision = scorePilot(responses, answers);
  assert.ok(noNegativeDecision.netAdditionalCorrect >= 8);
  assert.equal(noNegativeDecision.rejectedUnsupported, 0);
  assert.equal(noNegativeDecision.usefulnessGatePassed, false);
});

test("pilot scoring counts timed-out answers as incorrect and rejects duplicate or missing presentations", async () => {
  const { answers, responses } = await syntheticResponses();
  responses[0].elapsedSeconds = 181;
  assert.equal(scorePilot(responses, answers).controlCorrect + scorePilot(responses, answers).treatmentCorrect, 71);
  assert.throws(() => scorePilot(responses.slice(1), answers));
  responses[1] = { ...responses[0] };
  assert.throws(() => scorePilot(responses, answers));
});

test("pilot pooled improvement cannot override a participant whose treatment accuracy is lower", async () => {
  const { answers, responses } = await syntheticResponses();
  for (const entry of responses.filter((response) => response.participant === 1 && response.format === "control")) entry.decision = null;
  responses.find((response) => response.participant === 2 && response.format === "treatment")!.decision = null;
  const scored = scorePilot(responses, answers);
  assert.ok(scored.netAdditionalCorrect >= 8);
  assert.equal(scored.noParticipantWorse, false);
  assert.equal(scored.usefulnessGatePassed, false);
});
