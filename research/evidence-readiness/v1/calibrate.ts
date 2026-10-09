import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { equalFacts, runFixture, type Facts } from "./fixtures.ts";

export const STATES = ["SUPPORTED", "PARTIAL", "UNAVAILABLE", "UNKNOWN_MUST_ABSTAIN"] as const;
export type State = typeof STATES[number];
export interface Card { id: string; title: string; comparison: string; measurementScope: string; measurements: Facts; evidence: string[] }
export interface Answer { id: string; classification: State; expectedMeasurements: Facts; reason: string; evidence: string[] }
interface Schema {
  type?: string | string[]; enum?: unknown[]; pattern?: string;
  minimum?: number; minLength?: number; maxLength?: number; minItems?: number; maxItems?: number; minProperties?: number;
  additionalProperties?: boolean; required?: string[]; properties?: Record<string, Schema>; items?: Schema;
}

const root = new URL("./", import.meta.url);
const frozenNames = ["design-review.md", "protocol.md", "case-schema.json", "cases.json", "answer-key.json", "fixtures.ts"];

/** Small validator for the documented JSON Schema subset used by this research artifact. */
export function validateSchema(value: unknown, schema: Schema): void {
  const invalid = () => { throw new Error("research_schema_invalid"); };
  const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "number" && Number.isInteger(value) ? "integer" : typeof value;
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).includes(kind)) invalid();
  if (schema.enum && !schema.enum.includes(value)) invalid();
  if (typeof value === "number" && (!Number.isFinite(value) || (schema.minimum !== undefined && value < schema.minimum))) invalid();
  if (typeof value === "string" && ((schema.minLength !== undefined && value.length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) invalid();
  if (Array.isArray(value)) {
    if ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)) invalid();
    if (schema.items) for (const item of value) validateSchema(item, schema.items);
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (schema.minProperties !== undefined && Object.keys(record).length < schema.minProperties) invalid();
    for (const required of schema.required ?? []) if (!Object.hasOwn(record, required)) invalid();
    for (const [key, entry] of Object.entries(record)) {
      if (!schema.properties?.[key]) { if (schema.additionalProperties === false) invalid(); }
      else validateSchema(entry, schema.properties[key]);
    }
  }
}

export async function readArtifacts(): Promise<{ cards: Card[]; answers: Answer[]; schema: Schema }> {
  const schema = JSON.parse(await readFile(new URL("case-schema.json", root), "utf8")) as Schema;
  const cards: unknown = JSON.parse(await readFile(new URL("cases.json", root), "utf8"));
  validateSchema(cards, schema);
  const key = JSON.parse(await readFile(new URL("answer-key.json", root), "utf8")) as { protocolVersion: string; baseline: string; answers: Answer[] };
  if (key.protocolVersion !== "ERR-CAL-1" || key.baseline !== "97a1047961cacdb6b44d2b13ee81ae5c97690b55" || !Array.isArray(key.answers) || key.answers.length !== 24) throw new Error("research_key_invalid");
  const typedCards = cards as Card[];
  const cardIds = new Set(typedCards.map((card) => card.id));
  const keyIds = new Set(key.answers.map((answer) => answer.id));
  if (cardIds.size !== 24 || keyIds.size !== 24) throw new Error("research_ids_invalid");
  for (const answer of key.answers) {
    const card = typedCards.find((entry) => entry.id === answer.id);
    if (!card || !STATES.includes(answer.classification) || !equalFacts(card.measurements, answer.expectedMeasurements)) throw new Error("research_key_mismatch");
  }
  for (const state of STATES) if (key.answers.filter((answer) => answer.classification === state).length !== 6) throw new Error("research_strata_invalid");
  return { cards: typedCards, answers: key.answers, schema };
}

export async function verifyFreeze(): Promise<void> {
  const manifest = JSON.parse(await readFile(new URL("freeze-manifest.json", root), "utf8")) as { protocolVersion: string; files: Record<string, string> };
  if (manifest.protocolVersion !== "ERR-CAL-1" || Object.keys(manifest.files).length !== frozenNames.length) throw new Error("research_freeze_invalid");
  for (const name of frozenNames) {
    const digest = createHash("sha256").update(await readFile(new URL(name, root))).digest("hex");
    if (manifest.files[name] !== digest) throw new Error("research_freeze_changed");
  }
}

export async function calibrate() {
  await verifyFreeze();
  const { cards, answers, schema } = await readArtifacts();
  const cases: Array<{
    id: string; expectedClassification: State; classification: State;
    status: "PASS" | "FAIL"; measurementMatch: boolean; measurements: Facts;
    checks: Array<{ id: string; passed: boolean }>;
  }> = [];
  for (const card of cards) {
    const answer = answers.find((entry) => entry.id === card.id)!;
    let measurements: Facts = {};
    let checks: Array<{ id: string; passed: boolean }> = [];
    let executionPassed = true;
    try {
      const fixture = await runFixture(card.id);
      measurements = fixture.measurements;
      checks = fixture.checks;
      validateSchema(measurements, schema.items!.properties!.measurements);
    } catch {
      executionPassed = false;
      // Never serialize an exception, raw metric, request buffer, or response buffer.
      measurements = {};
      checks = [{ id: "fixture_execution", passed: false }];
    }
    const measurementMatch = executionPassed && equalFacts(measurements, answer.expectedMeasurements);
    const passed = measurementMatch && checks.length > 0 && checks.every((check) => check.passed);
    cases.push({
      id: card.id, expectedClassification: answer.classification,
      classification: passed ? answer.classification : "UNKNOWN_MUST_ABSTAIN" as State,
      status: passed ? "PASS" : "FAIL", measurementMatch, measurements, checks,
    });
  }
  return {
    protocolVersion: "ERR-CAL-1",
    substrate: "97a1047961cacdb6b44d2b13ee81ae5c97690b55",
    status: cases.every((entry) => entry.status === "PASS") ? "PASS" : "FAIL",
    caseCount: cases.length,
    classificationCounts: Object.fromEntries(STATES.map((state) => [state, cases.filter((entry) => entry.classification === state).length])),
    liveRuns: 0, participantRuns: 0, productionReportImplemented: false,
    cases,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const report = await calibrate();
    await writeFile(new URL("calibration-results.json", root), JSON.stringify(report, null, 2) + "\n", "utf8");
    process.stdout.write("ERR-CAL-1: " + report.status + "; " + report.caseCount + " cases; sanitized results written.\n");
    if (report.status !== "PASS") process.exitCode = 1;
  } catch {
    process.stderr.write("ERR-CAL-1: artifact integrity or schema verification failed; no result file written.\n");
    process.exitCode = 1;
  }
}
