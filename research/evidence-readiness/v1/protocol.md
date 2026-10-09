# Evidence Readiness measurement calibration protocol v1

**Date:** 2026-10-09  
**Baseline:** v0.1.0 at 97a1047961cacdb6b44d2b13ee81ae5c97690b55  
**Source comparison:** current main 6cc6d27172b9b04b15dd8f4d1fbba6f70ac5e3eb; measurement runtime sources unchanged.  
**Status:** frozen before calibration; results are recorded separately.

## Purpose

Exercise the unchanged v0.1.0 server, observer, and recurrence tracker through a deterministic fixture runner. Compare its actual projected measurement facts with predeclared expected facts, run independent fixed checks, and verify paired-world equality for cases the current observation boundary cannot distinguish.

This is a measurement calibration, not a classifier evaluation. The four evidence states are annotations in the frozen fixture key, attached only after the underlying measurement checks are evaluated. The runtime and fixture runner do not predict those labels. The runner/tests are research calibration code, not a generic classifier or production report.

## Fixture scope

- Exactly 24 synthetic, content-free fixtures: six annotated SUPPORTED, six PARTIAL, six UNAVAILABLE, and six UNKNOWN_MUST_ABSTAIN.
- Each fixture asks one nominated comparison, defines expected projected measurement facts, includes independent fixed checks, and has one rubric annotation. It must not create multiple implicit scored decisions.
- Only generated synthetic request/SSE buffers are input to the unchanged runtime, transiently in memory. No live/captured raw bytes are input. Do not persist those buffers.
- Keep actual expected facts and checks fixed before running. Unknown fixtures must form explicit pairs: both worlds must produce identical approved measurement projections while their predeclared underlying-world facts require different answers.

## Procedure

1. Freeze the 24 fixtures, expected measurement facts, independent checks, projection, and rubric annotations before execution.
2. Run each fixture through the unchanged release server/observer/tracker. No live harness, provider, or captured metrics dump participates.
3. Compare the actual projected measurements with that fixture’s expected measurements. Run its independent checks, such as byte-preserving forwarding, expected bounded/unavailable behavior, and strict approved-field projection.
4. For each unknown pair, assert exact equality of approved measurement projections and retain the pair’s distinct predeclared underlying-world facts only as content-free fixture metadata.
5. Record one per-case result containing case ordinal, rubric annotation, approved actual measurement facts, expected-measurement match, independent-check outcomes, and paired-world equality where applicable. Do not record raw request/SSE bytes, UUIDs, paths, absolute timestamps, prompts, source, tool output, credentials, or provider bodies.
6. Report all 24 cases, match counts by annotation, independent-check failures, schema/projection violations, and unknown-pair equality results. Do not convert annotations into predicted classifier outputs or report a confusion matrix/classifier accuracy.

## Pass rule and interpretation

Pass only if all 24 actual measurement projections match their predeclared expected facts; all independent fixed checks pass; the projection contains only approved fields; and every unknown pair produces identical approved measurement projections despite its differing required decisions. Any mismatch, privacy/schema escape, failed independent check, or unequal unknown pair fails calibration. Do not silently alter fixtures, expected facts, labels, or criteria after seeing results.

A pass establishes only that the unchanged runtime produces the expected measurements on these frozen synthetic fixtures and that the specified indistinguishable pairs are indistinguishable under the approved projection. It does not establish that a classifier or report exists or works, that developers make better decisions, that fixtures represent live frequency, that all runtime observations are complete, that a live profile preserves task outcomes, or that an optimization is eligible.

## Deferred human-use pilot (not part of v1)

A later, separately reviewed pilot may compare a flat sanitized-facts table (control) with a manually grouped presentation of the same approved facts and definitions (treatment). Neither presentation may expose expected labels or evaluator key. Use a held-out case set; do not use public calibration cards/key with participants who can access them or have prior exposure. Keep key and condition mapping private until scoring is final.

If three developers are used, each reviews 24 distinct presentations: 12 control and 12 treatment, with a three-minute limit per case; unanswered cases count incorrect. Freeze task questions and the evaluator key before building the treatment, and have the scorer blinded to format labels. No developer sees the same case in both formats. Two developers receive inverse schedules. The third schedule is stratified by state and difficulty so every case appears in both formats across participants and each arm has balanced state totals. Exact 1:1 balance per case is impossible with three exposures; report the resulting 2:1 card assignments and residual case/reviewer confounding. Score one predeclared categorical decision per presentation, publish counts/denominators and each participant’s scores, and do not make inferential or general-population claims.

The proposed exploratory gate is at least 8 net more correct answers in treatment among 36 judgments per arm (22.22 percentage points, the first attainable increase above 20pp), no participant with lower treatment accuracy, no false support on non-supported states, and at least one supported comparison accepted and one non-supported comparison rejected. This pilot is not run under calibration v1 and cannot be claimed from its results.

## Stop conditions

Stop and report calibration failure if an unapproved field reaches input/output; a fixture contains disallowed content/identifiers; expected facts are ambiguous; an independent check fails; an unknown pair’s approved projections differ; a required case/result is missing; or any raw buffer is persisted.

No live run, human pilot, classifier evaluation, or production-report implementation is authorized by this protocol.
