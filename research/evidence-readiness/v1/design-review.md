# Evidence Readiness calibration design review

**Date:** 2026-10-09  
**Protocol:** v1, frozen before calibration; results are recorded separately.  
**Evidence baseline:** v0.1.0, commit 97a1047961cacdb6b44d2b13ee81ae5c97690b55  
**Source comparison:** current main 6cc6d27172b9b04b15dd8f4d1fbba6f70ac5e3eb; relevant runtime sources are unchanged.

## Decision and scope

Calibrate the existing v0.1.0 server, observer, and recurrence tracker on 24 synthetic, content-free fixtures. The fixture runner compares actual projected measurements with predeclared expected measurements, checks independent forwarding/privacy/limit properties, and verifies equality for paired worlds that the observation boundary cannot distinguish.

This is measurement calibration, not a classifier test. There is no generic classifier to run: the four evidence states below are rubric annotations attached to cases only after their measurement checks pass. This phase does not test report automation, developer usefulness, provider prevalence, task efficiency, or task preservation. Live provider runs, human participants, and production reporting are out of scope.

The calibration fixture runner and its tests may be implemented for this phase. They execute the unchanged v0.1.0 measurement runtime against generated synthetic bytes. They must not add a production report or modify the runtime.

## v0.1.0 observation boundary

The proxy buffers request bodies before forwarding. Structural Responses observation is opt-in. Canonical byte sizes include serialized scalar values transiently, so they are not pure structural overhead, token counts, or semantic relevance.

The response observer records forwarded body bytes, selected local timings, a recognized response.completed marker, and numeric usage found in parseable SSE data. Event text is parsed transiently. The incomplete flag covers known overflow and unterminated-final-frame cases; false does not certify valid or complete parsing. Numeric usage is not proven final or complete.

Metrics are recorded on exchange completion/error; at most 100 recent rows are retained in process memory. Lifetime totals count recorded outcomes, not every attempted or in-flight request. Unsupported routes, health, and no-upstream-configured responses do not provide a Responses observation. A missing row does not prove no exchange was attempted. Pipeline completion, a recognized terminal marker, and an external task verifier are independent facts.

Pi protocol/action adapters write separate bounded local spools. Their fixed summaries have no validated cross-boundary join to proxy rows. Action call IDs are transient recorder keys and are not persisted. These boundaries are supported by release source and fixture tests; they do not establish universal provider/parser coverage.

Source anchors in the audited release: src/app.ts, src/observation.ts, src/metrics.ts, src/protocol-capture.ts, src/action-observation.ts and corresponding tests.

## Prior memo weaknesses and amendment register

This register records the changes made before calibration. The earlier memo remains an audit record; these amendments are explicit.

| ID | Earlier proposal weakness | Amendment for this calibration |
| --- | --- | --- |
| AR-1 | Three paired live Codex cells tested profile availability and observation-on task preservation, not measurement calibration. Task/model variance would confound this phase. | Remove live cells. Use generated synthetic request/SSE buffers only. Any live profile study needs a separate reviewed protocol. |
| AR-2 | The earlier 24-card plan did not enumerate an unambiguous 24 and invited multiple measurement decisions per card. | Freeze 24 fixtures, six with each rubric annotation. Each fixture has one nominated comparison and predeclared expected measurements; annotations are not runtime/classifier outputs. |
| AR-3 | The 20pp future pilot gate was not reconciled with integer counts or exact format assignment. With 36 judgments per arm, 8 net more correct is 22.22pp; each reviewer has 12 per arm, or 8.33pp increments. Three reviewers give each card three exposures, so exact per-card balance is impossible. | Defer the pilot. If separately approved, use two inverse schedules and a third schedule stratified by state and difficulty; every card appears in both formats and arm-level state totals balance. Report the residual 2:1 per-card assignment and case/reviewer confounding. Require at least 8 net additional correct of 36 and no reviewer with lower treatment accuracy. Three reviewers support no inferential/general-population claim. |
| AR-4 | Showing expected labels or exclusions in treatment leaks the answer key. Public case/key exposure also invalidates a blind human study. | Defer human testing. Any later study must use a held-out case set, keep the key and expected labels outside participant materials, screen for prior key/case exposure, and keep the evaluator key private until scoring is final. Treatment may group the same facts/definitions, not reveal expected classifications. |
| AR-5 | “Complete,” “unavailable,” and “unknown” could be mistaken for task/stream properties. Stable snapshots or incomplete=false could be overread as completeness. | Define each state for one nominated comparison only. A pair of underlying worlds with identical approved measurement projections but different required decisions is UNKNOWN_MUST_ABSTAIN. “No known incompleteness detected” never means complete. |
| AR-6 | Human decision improvement or synthetic calibration could be overclaimed as classifier accuracy or live prevalence. | Calibration tests actual runtime projections against expected facts. State annotations are rubric labels, never predicted outputs. Any later human-use, automation, or live-applicability claim needs its own gate. |
| AR-7 | A missing row/value has multiple possible causes; inferring the cause is unsupported. | Do not infer causes from absence. Mark a comparison UNKNOWN_MUST_ABSTAIN when the requested decision depends on an unobservable distinction. |

## Frozen comparison-validity rubric

Each fixture defines one nominated comparison, an approved measurement projection, expected measurement facts, independent checks, and one rubric annotation. The four labels are protocol-defined annotations; they are not v0.1.0 runtime fields or classifications.

- **SUPPORTED:** actual observed facts support the local captured-fact question. This does not support a whole-run, task-outcome, causal, or semantic claim.
- **PARTIAL:** a known subset of the requested evidence is present, but not enough for the full nominated comparison.
- **UNAVAILABLE:** a required measurement is absent from the specified evidence, including an unsupported measurement/encoding, or an external task contract is explicitly known to have failed. The label records evidence availability; it does not infer why a value is absent.
- **UNKNOWN_MUST_ABSTAIN:** paired underlying worlds yield the same approved measurement projection but require different answers to the nominated comparison. The measurement boundary cannot identify which world occurred.

These are not global run-readiness labels. A missing usage number can be UNAVAILABLE when the comparison asks whether that required number was recorded. It is UNKNOWN_MUST_ABSTAIN if the claim distinguishes omission from malformed/ignored data and both yield the same projection.

Unknown fixture families include: omitted versus malformed/ignored usage; no recognized response.completed versus an unrecognized terminal/failure event; zero recorded rows versus unsupported or unrecorded attempts; stable snapshot versus unobserved in-flight/late exchange; retry versus independent duplicate request; and task pass versus fail when transport facts are identical and no external verifier result exists.

## Privacy and result handling

Only generated synthetic request/SSE buffers may enter the unchanged runtime, transiently in memory. No live or captured raw bytes are inputs; no request/response buffers are persisted. Store per-case content-free approved measurement facts, expected measurement checks, independent-check results, and rubric annotation. Do not store raw prompts, source, tool output, credentials, provider bodies, personal paths, request UUIDs, or absolute timestamps. Never persist raw /metrics snapshots. Numeric sizes, recurrence categories, and timings still expose workload metadata; use only fields needed by the fixture and keep artifacts local.

## Review gate

A calibration result must distinguish measurement mismatches from fixture/check failures and preserve all 24 case records. A pass applies only to the frozen synthetic fixtures and unchanged runtime projection. It does not establish provider generality, developer benefit, task preservation, or optimization eligibility. Further live or human work requires a separately reviewed protocol.
