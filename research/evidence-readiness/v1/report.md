# Evidence Readiness calibration review

Date: 2026-10-09. Protocol: ERR-CAL-1. Disposition: **HOLD FOR PROTOCOL
REVISION; overall calibration gate NOT ESTABLISHED.**

All 24 fixtures matched their frozen measurement projections and all 79
programmed checks passed. That result does not satisfy the full frozen
protocol: C24 does not execute the required distinct empirical worlds. Its
equality check ignores its external-outcome argument. The original inputs and
runner result are preserved; this review does not retrospectively change a
pass condition to obtain success. The machine-readable
[review outcome](review-outcome.json) distinguishes these two conclusions.

## Experiment design review

Evidence Readiness remains a reasonable candidate for the next research
question: can a presentation of existing facts help a developer reject
unsupported comparisons while accepting supported local comparisons? It
requires no request transformation, model call, new observation boundary, or
production report to test that hypothesis. Developer usefulness remains
unmeasured, and proceeding beyond this calibration is not justified yet.

The release baseline is v0.1.0 at
`97a1047961cacdb6b44d2b13ee81ae5c97690b55`. The research branch starts from main
at `6cc6d27172b9b04b15dd8f4d1fbba6f70ac5e3eb`. Runtime sources, extensions,
existing scripts, existing tests, dependencies, and TypeScript configuration
are unchanged from the release. The only package change is an explicit
research calibration command. The documentation changes provide neutral
project indexes and an evidence ledger; historical records remain linked at
the release tag rather than being rewritten or presented as current guidance.

The runtime path remains: client HTTP route selection → bounded request-body
read → opt-in identity/zstd structural observation → unchanged upstream
forwarding → response-header timing and streaming observation → pipeline
completion/error → process-local metric record. Responses observation applies
to the Responses route and alias; the chat-completions route has synthetic
transport coverage. Unsupported routes and an unconfigured upstream can
return without recording a provider exchange. Metrics retain the latest 100
recorded rows, not every attempted or in-flight request.

The [pre-calibration design review](design-review.md) records amendments to
the initial memo. The important weaknesses are:

- Twenty-four cases are sufficient for a bounded boundary-check bank. They
  are not exhaustive parser, provider, concurrency, or usability coverage.
- Each card asks one nominated comparison. Expanding the denominator by
  counting several subdecisions would change the proposed pilot gate.
- At 36 judgments per arm, 20 percentage points is not an attainable exact
  increment: seven net correct answers is 19.44pp and eight is 22.22pp.
  Requiring eight, no participant worse, and no false support is internally
  coherent as an exploratory gate. Three developers do not establish
  population effectiveness or remove reviewer/case confounding.
- Three exposures per case cannot balance formats exactly. Two inverse
  schedules plus a third state-balanced schedule leave 2:1 case assignments.
  The frozen protocol also promises difficulty stratification; the scorer has
  no difficulty variable and does not implement it. This must be amended
  before any participant study.
- Public cases, titles, evidence references, and answer keys can reveal
  answers. A later blinded study requires held-out materials, a hidden key,
  screened exposure, and both formats containing the same facts/definitions.
- `SUPPORTED` is local to a question, not whole-run readiness. Encountered
  numeric usage does not establish final usage or billing; HTTP completion
  does not establish task preservation; `incomplete=false` does not certify
  successful parsing.
- The rubric's C18 use of `UNAVAILABLE` for an explicitly failed external
  task contract mixes evidence availability with admissibility. The failure
  is known, but the proposed preserved-task comparison is inadmissible.
  Retain the frozen annotation for audit; clarify this taxonomy in a revision.

## Frozen inventory and calibration evidence

[Case cards](cases.json), [schema](case-schema.json), and
[answer key](answer-key.json) contain the exact expected fields and rationale
for every comparison. [Fixture source](fixtures.ts) defines the generated
inputs and fixed checks; [results](calibration-results.json) retain approved
facts, expected-fact matches, and named check outcomes only.

The table reports the frozen rubric annotation, not a classifier prediction.
Every row's measurement projection matched. HTTP means an actual loopback
exchange through the unchanged server; component means direct use of the
release observer, recurrence tracker, or metric store. A matching assertion
does not independently validate the rubric annotation.

| Case | Nominated evidence | Frozen state | Calibration method and limit |
| --- | --- | --- | --- |
| C01 | Identity input-item count | SUPPORTED | HTTP; count 1 and request/response/status preservation |
| C02 | Zstd decoded input-item count | SUPPORTED | HTTP; count 1, compressed wire bytes preserved |
| C03 | Encountered cached-token numeric zero | SUPPORTED | Observer; tuple 12/8/20 with cached 0 retained |
| C04 | Availability of local timing fields | SUPPORTED | HTTP; header/body/duration presence and ordering, no performance claim |
| C05 | Exact canonical recurrence | SUPPORTED | Tracker; reordered keys match one previously observed item |
| C06 | Cancellation before/after recognized marker | SUPPORTED | Two HTTP exchanges; both disconnect, marker-relative flags differ |
| C07 | Joint input/output usage | PARTIAL | Observer; input 12 present, output/total/cache absent |
| C08 | Full encountered usage tuple | PARTIAL | Observer; invalid negative/string fields ignored, cached 0 retained |
| C09 | Byte arrival and marker coverage beyond cap | PARTIAL | Observer; bytes present, known pending-buffer limit, no marker |
| C10 | Byte arrival and complete final-frame observation | PARTIAL | Observer; unterminated final frame marked incomplete |
| C11 | Cumulative process-local count and full status distribution | PARTIAL | Store; 101 recorded, 100 retained; evicted status difference hidden |
| C12 | Recurrence counts and exhaustive groups | PARTIAL | Tracker; 65 recurring groups, 64 exposed, limits flagged; separate input cap checked |
| C13 | Encountered input/output usage | UNAVAILABLE | Observer; all four usage values absent, recognized marker still present |
| C14 | Decoded gzip structure | UNAVAILABLE | HTTP; `content_encoded`, original bytes preserved |
| C15 | Decoded malformed zstd structure | UNAVAILABLE | HTTP; `zstd_decode_failed`, original bytes preserved |
| C16 | Decoded structure beyond zstd output cap | UNAVAILABLE | HTTP; `zstd_output_limit`, original bytes preserved |
| C17 | First-body-byte timing on empty response | UNAVAILABLE | HTTP; 204 pipeline completes, headers observed, no body timing |
| C18 | Task preservation with declared verifier failure | UNAVAILABLE | HTTP facts plus fixed external FAIL/PASS/PASS declarations; no verifier executed |
| C19 | Missing usage: omission vs ignored malformed data | UNKNOWN / MUST ABSTAIN | Observer pair; distinct equal-length frames yield equal selected facts, incomplete flag false |
| C20 | `response.failed` vs `response.incomplete` | UNKNOWN / MUST ABSTAIN | Two HTTP exchanges; equal selected lifecycle/usage/size facts; event family unrecorded |
| C21 | No supported attempts from zero recorded rows | UNKNOWN / MUST ABSTAIN | HTTP route/configuration pair; counts equal at zero; returned statuses differ outside count projection |
| C22 | Whole-run completeness from stable snapshots | UNKNOWN / MUST ABSTAIN | HTTP; idle and held in-flight count snapshots equal; late outcome later recorded |
| C23 | Retries vs independent repeated requests | UNKNOWN / MUST ABSTAIN | Two repeated HTTP sequences; retry intent externally assigned, not a retry generator or cause measurement |
| C24 | Task outcome from successful transport alone | UNKNOWN / MUST ABSTAIN | One HTTP capture; task fields absent; claimed paired-outcome check is nonconformant |

Annotation totals: 6 SUPPORTED, 6 PARTIAL, 6 UNAVAILABLE, and 6 UNKNOWN /
MUST ABSTAIN. There are not 24 supported comparisons or six empirically
validated task-outcome pairs.

## Existing coverage and additional checks

The unchanged [proxy tests](../../../test/proxy.test.ts) already cover
structural canonicalization, byte-preserving forwarding, usage on the tested
Responses alias, exact recurrence, bounded retention, post-marker
cancellation, SSE pending/final-frame incompleteness, malformed zstd, and the
zstd output cap. These support the measurement families in C01–C06,
C09–C12, and C15–C16. They do not previously establish every specific card or
its answer annotation.

The research fixtures add narrowly scoped checks for explicit zero versus
absence/filtering (C03, C07–C08, C13); a before-marker cancellation twin
(C06); evicted-status ambiguity and exposed recurrence-group limits
(C11–C12); gzip structural unavailability and an empty body (C14, C17);
equal-observation parser/event-family pairs (C19–C20); unrecorded-route and
in-flight count ambiguity (C21–C22); and absence of retry/task-outcome fields
in the selected configuration (C23–C24). No runtime measurement was added.
C18's external result is a declaration, not missing verifier coverage made
available by this work.

The new [research tests](../../../test/evidence-readiness-calibration.test.ts)
check artifact integrity, closed field/value schemas, all 24 expected
projections, and the future scoring arithmetic. Scoring tests cover seven
versus eight net correct, harmful false support, universal abstention,
timeouts, missing/duplicate responses, and pooled improvement with an
individual participant worse. Synthetic scoring inputs are not participant
results.

## Post-freeze findings and protocol nonconformance

| Finding | Consequence | Required next action |
| --- | --- | --- |
| C24's projection function ignores its external-outcome argument and reuses one transport capture. | The equality assertion is circular. Metric-field absence is useful structural evidence, but the frozen rule requiring distinct empirical worlds is unmet. The overall protocol gate is not established despite runner PASS. | Review a versioned amendment distinguishing structural impossibility checks from empirical pairs, or design a genuinely separate bounded synthetic pair. Keep task outcome unknown; add no telemetry. |
| C18 supplies fixed external declarations, and C23 assigns scheduling intent externally. | Their task/retry facts are not discovered by Inlay. They cannot validate a verifier, retry detector, or live outcome correlation. | Preserve declared versus measured provenance explicitly in any revised schema; avoid claims of empirical outcome separation. |
| `calibrate.ts` and `scoring.ts` were outside the six-file pre-execution freeze. | The original manifest does not bind the runner or future scorer. | The separate execution manifest binds reviewed public source/results after execution only. Freeze the full execution chain before a revised run. |
| Third-reviewer schedule lacks a difficulty measure. | The deferred pilot is not executable exactly as frozen. | Either predeclare a defensible difficulty variable or explicitly remove that requirement; review before human testing. |
| Several equality checks intentionally compare a projection, not entire runtime state. | C21 statuses distinguish its worlds if supplied; numeric wall-clock timings can vary in C20. Selected timing-presence facts do not encode an event family. | Restrict conclusions to each nominated projection. Do not claim all possible observations are identical. |

No frozen file was edited after calibration to conceal these findings. The
[freeze manifest](freeze-manifest.json) covers the original six inputs.
[Execution manifest](execution-manifest.json) is a post-execution provenance
snapshot; it cannot retrospectively supply a missing pre-execution freeze.

## Measurement gaps and mandatory abstention

The current boundary cannot establish final provider accounting from
encountered numbers, parse validity from a false incompleteness flag, a
terminal failure family from the retained completion-marker flag, attempted
or in-flight totals from recorded counts, full evicted history from a bounded
window, exhaustive groups after a cap, retry intent from repeated requests,
or verifier/scope/harness outcomes from transport success. Missing usage must
remain absent, not zero. Missing task evidence must remain unknown, not pass.

The selected fixtures do not measure prevalence or cover all SSE line
endings, arbitrary chunking, split UTF-8, multiple encoding headers,
timeouts, disconnect races, malformed request structures, every cap edge,
provider usage layouts, clock behavior, or concurrent execution. Existing
tests retain their own narrower coverage; the 24-card bank does not convert
that into exhaustive validation. No cross-boundary join or task outcome
correlation is established.

## Verification and recommended next step

Local verification: 43 tests passed, zero failed (36 unchanged release tests
plus 7 research tests); TypeScript typecheck passed; the calibration runner
reported 24 measurement matches and 79 passing checks; `git diff --check`
passed. Release runtime, extension, script, dependency, configuration, and
existing-test comparisons were unchanged. These software checks do not
override the research nonconformance above.

The complete staged diff initially flagged two-space Markdown hard breaks in
the frozen review and protocol. File-specific whitespace attributes preserve
those original bytes while allowing intentional hard breaks; the staged diff
check was then repeated. No frozen input or expectation was changed.

Review the frozen bank and these limitations before further work. The next
authorized decision should be whether to approve a versioned research
revision that repairs the empirical-pair requirement and provenance freeze,
clarifies external declarations and the C18 taxonomy, and corrects the
deferred schedule specification. Then rerun calibration against the same
unchanged substrate. Do not begin live Codex cells, a human-use pilot, a
production report, or an efficiency claim on the current result.
