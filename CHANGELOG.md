# Changelog

All notable changes to this research prototype are documented here.

## v0.2.0 — Local Exchange Lifecycle

### Delivered

- Process-local `exchangeLifecycle` accounting in `GET /metrics`: admitted
  handlers, active handlers, actual local forwarding invocations and normal
  callback finalization. Developers can inspect pending supported work even
  when the outcome store is empty or stable.
- Bounded aggregate state with explicit unavailable/null counts; no added
  per-request lifecycle records or raw workload retention.

### Evidence

- LEA-2 matched seven included synthetic cases, including three disconnect
  trials and reversed concurrent completion on unchanged v0.1.0.
- LEA-3 production verification passed 46 tests, including all 36 release
  regressions, plus typecheck and Node 22.15.0 CI.
- Release publication requires the clean archive installation, test, typecheck
  and CLI startup gates in [release discipline](docs/releases.md). The published
  release's verification asset records the exact commit and archive checksum.

### Compatibility and limitations

- Existing configuration, dependencies, outcome fields and transport behavior
  remain unchanged. No storage migration; exact-key metrics clients must accept
  the additive `exchangeLifecycle` property.
- Unexpected observation-exception finalization and callback rejection
  preservation remain UNAVAILABLE. Aggregate forwarding cannot identify which
  active handler forwarded. No task-success, provider-receipt, retry, delivery,
  reliability, user-benefit or efficiency claim is established.
- GitHub source release only; no npm publication. Node minimum remains 22.15.0.

### Milestone decision

LEA-3's technical build is complete. Recommend LIMITED FIELD VALIDATION of the
existing pending-work diagnostic before any further capability is built.
Synthetic correctness is demonstrated; measured developer benefit is not.
No field study or new experiment is started by this release.

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
