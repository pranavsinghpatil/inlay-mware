# Changelog

## Unreleased — proposed v0.1.1

- Add process-local lifecycle counters to `GET /metrics`: admitted, active,
  local forwarding invocations and normally finalized handlers.
- Add regression coverage for normal, failure, streaming, disconnect and
  concurrent-handler paths. The complete suite contains 54 tests, including
  all 46 tests preceding the SSE correction.
- Correct SSE observation buffering so tested identical supported streams retain
  the same non-timing observations across chunk partitions. Preserve the frame
  cap and discard oversized frames through their delimiter before observing
  later frames.
- Add permanent differential regressions, including the reproduced 78,140-byte
  coalesced stream, and exact-limit, unfinished-input and oversized-suffix checks.
- Add extracted-source archive verification and provider-free startup checks.
- Document the additive metrics property and its availability/privacy limits.
  Existing configuration, dependencies and outcome definitions are unchanged.

This is a small instrumentation and release-maintenance update. It introduces
no optimization mechanism. Cost, latency and token reductions, measured
developer benefit and generalized reliability have not been established.
Unexpected observation-exception finalization remains unavailable, and forwarding
totals cannot identify which active handler forwarded. Publication is pending.

## Withdrawn designation: v0.2.0

The v0.2.0 designation was withdrawn because this update was not accepted as a
minor-version product milestone. The original tag and artifacts remain unchanged
for provenance. The latest accepted release remains v0.1.0.

## v0.1.0 — Evidence Baseline

### Added

- Transparent, loopback-only middleware foundation for supported HTTP provider
  exchanges.
- Validated Codex HTTP `POST /v1/responses` routing with SSE pass-through.
- Narrow Pi 0.86.0 `POST /v1/codex/responses` compatibility alias for the
  existing `openai-codex` OAuth experiment profile.
- Bounded structural and content-free observation, including zstd structural
  decoding that does not alter forwarded bytes.
- Sanitized C2 capability records and research decision records.

### Research findings

- Context growth and exact canonical recurrence were observed in a narrow
  Codex trajectory, without establishing semantic redundancy or removability.
- ObservationPack, Evidence-Preserving Reducer, and Online Context Compaction
  are not evidence-eligible for the observed trajectory.
- Action Fusion v1 did not preserve capability for its frozen pilot
  configuration and is not a release capability.
- The content-free cross-boundary timeline has no valid completed trajectory.

### Limitations

- No token, cost, latency, tool-call, or efficiency reduction is claimed.
- WebSocket and `GET /v1/models` are unsupported.
- The validated evidence is profile- and task-specific; Inlay does not claim
  general multi-harness support.
- `private: true` is retained: this is a GitHub research release, not an npm
  package publication.
