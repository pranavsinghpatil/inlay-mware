# Evidence Readiness Report: calibration v1

Status: **research-only; calibration gate NOT ESTABLISHED; review hold.**
The runner matched all 24 expected projections and its selected checks, but
C24 does not meet the frozen empirical-pair requirement. Read the
[post-calibration review](report.md) before interpreting the runner's `PASS`.
This directory contains no production report, participant pilot, live-provider
run, or new telemetry.

The experiment tests which nominated comparisons the v0.1.0 measurement
boundary can establish and where it must abstain. Calibration precedes any
usability or live-profile study.

| Artifact | Purpose |
| --- | --- |
| [Design review](design-review.md) | Explicit weaknesses and amendments to the initial memo |
| [Frozen protocol](protocol.md) | Definitions, controls, scoring and stop rules |
| [Case schema](case-schema.json) | Strict content-free case-card contract |
| [Case cards](cases.json) | Exactly 24 comparisons and measurement facts |
| [Frozen answer key](answer-key.json) | Evaluator classifications, expected states and rationale |
| [Freeze manifest](freeze-manifest.json) | Integrity hashes of the six frozen research artifacts, including fixture checks |
| [Calibration program](calibrate.ts) | Checks over unchanged v0.1.0 components |
| [Calibration results](calibration-results.json) | Approved states and pass/fail evidence only |
| [Review outcome](review-outcome.json) | Separates runner success from the unestablished protocol gate |
| [Execution manifest](execution-manifest.json) | Post-execution source/result hashes; not a pre-execution freeze |
| [Research report](report.md) | Results, limitations and recommended next decision |

Run from the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm typecheck
pnpm research:calibrate
git diff --check
```

The calibration command writes only `calibration-results.json`. It reports
fixture checks, not the review gate in `review-outcome.json`. Re-running it
does not resolve the recorded protocol nonconformance. The execution manifest
is a separate post-execution audit snapshot and must be checked again if any
hashed artifact changes. Its SHA-256 hashes use UTF-8 text with CRLF normalized
to LF for cross-platform comparison. Request/SSE
buffers are generated, compared and discarded in memory. No raw metric dump,
request ID, timestamp, source, tool output, credential or reusable request
fingerprint is exported. Manifest hashes identify public research files, not
provider payloads. Synthetic fixture generators are source code; serialized
request/SSE captures are never written.

`SUPPORTED` applies only to the nominated comparison and declared scope.
`PARTIAL`, `UNAVAILABLE` and `UNKNOWN_MUST_ABSTAIN` prohibit accepting the
full comparison. The runner's annotations come from the frozen answer key;
they are not predicted classifications. A matching fixture does not establish
developer usefulness. The frozen inputs are preserved with their weaknesses
so a revised protocol can be reviewed explicitly.

The answer key is public for auditability. A future participant packet must
exclude it, the calibration evidence, and case titles/evidence labels that
disclose answers. No human-use result is claimed here.
