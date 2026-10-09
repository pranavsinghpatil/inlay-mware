import { STATES, type Answer, type State } from "./calibrate.ts";

export type Format = "control" | "treatment";
export interface Assignment { participant: 1 | 2 | 3; id: string; format: Format }
export interface Response extends Assignment { decision: State | null; elapsedSeconds: number }

/** Future pilot assignments only; this function does not run or present a participant study. */
export function assignments(answers: Answer[]): Assignment[] {
  const schedule: Assignment[] = [];
  for (const state of STATES) {
    const group = answers.filter((answer) => answer.classification === state);
    if (group.length !== 6) throw new Error("scoring_strata_invalid");
    for (const participant of [1, 2, 3] as const) {
      group.forEach((answer, index) => {
        const control = participant === 1 ? index % 2 === 0 : participant === 2 ? index % 2 !== 0 : [0, 3, 4].includes(index);
        schedule.push({ participant, id: answer.id, format: control ? "control" : "treatment" });
      });
    }
  }
  return schedule;
}

/** One exact categorical answer per presentation; no metric-by-metric denominator expansion. */
export function scorePilot(responses: Response[], answers: Answer[]) {
  const expected = assignments(answers);
  if (responses.length !== 72) throw new Error("scoring_denominator_invalid");
  const key = (value: Assignment) => value.participant + ":" + value.id + ":" + value.format;
  const expectedKeys = new Set(expected.map(key));
  const receivedKeys = new Set(responses.map(key));
  if (receivedKeys.size !== 72 || [...receivedKeys].some((value) => !expectedKeys.has(value))) throw new Error("scoring_assignment_invalid");
  const participants = [1, 2, 3].map((participant) => ({ participant, controlCorrect: 0, treatmentCorrect: 0, controlCount: 0, treatmentCount: 0 }));
  let treatmentFalseSupported = 0;
  let acceptedSupported = 0;
  let rejectedUnsupported = 0;
  for (const response of responses) {
    if (!Number.isFinite(response.elapsedSeconds) || response.elapsedSeconds < 0 || (response.decision !== null && !STATES.includes(response.decision))) throw new Error("scoring_response_invalid");
    const answer = answers.find((entry) => entry.id === response.id)!;
    const timely = response.elapsedSeconds <= 180;
    const correct = timely && response.decision === answer.classification;
    const participant = participants[response.participant - 1];
    if (response.format === "control") { participant.controlCount++; if (correct) participant.controlCorrect++; }
    else {
      participant.treatmentCount++;
      if (correct) participant.treatmentCorrect++;
      if (response.decision === "SUPPORTED" && answer.classification !== "SUPPORTED") treatmentFalseSupported++;
      if (correct && answer.classification === "SUPPORTED") acceptedSupported++;
      if (correct && answer.classification !== "SUPPORTED") rejectedUnsupported++;
    }
  }
  const controlCorrect = participants.reduce((total, participant) => total + participant.controlCorrect, 0);
  const treatmentCorrect = participants.reduce((total, participant) => total + participant.treatmentCorrect, 0);
  const netAdditionalCorrect = treatmentCorrect - controlCorrect;
  const noParticipantWorse = participants.every((participant) => participant.treatmentCorrect >= participant.controlCorrect);
  return {
    controlCount: 36, treatmentCount: 36, controlCorrect, treatmentCorrect,
    netAdditionalCorrect, pooledGainPercentagePoints: 100 * netAdditionalCorrect / 36,
    treatmentFalseSupported, acceptedSupported, rejectedUnsupported, noParticipantWorse, participants,
    usefulnessGatePassed: netAdditionalCorrect >= 8 && noParticipantWorse && treatmentFalseSupported === 0 && acceptedSupported > 0 && rejectedUnsupported > 0,
  };
}
