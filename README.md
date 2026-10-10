<h1 align="center">
  <img src="assets/inlay-mark.png" width="48" alt="Inlay layered middleware mark" valign="middle" />
  <span>Inlay</span>
</h1>

<p align="center">
  <a href="https://github.com/pranavsinghpatil/inlay-mware/actions/workflows/ci.yml"><img src="https://github.com/pranavsinghpatil/inlay-mware/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/pranavsinghpatil/inlay-mware/releases/latest"><img src="https://img.shields.io/github/v/release/pranavsinghpatil/inlay-mware?display_name=tag&sort=semver" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" /></a>
</p> 





**A local-first research middleware for making coding-agent workflows
observable—without replacing the agent, changing its backend, or pretending
unproven optimizations work.**

```text
coding harness → Inlay → existing provider/backend
```

It is not a coding agent, agent runner, generic wrapper, universal harness
router, credential manager, or established optimizer. Efficiency mechanisms
remain research hypotheses; none is a released capability.

> **The question Inlay is built for:** What is an agent actually sending,
> waiting on, and repeating—and can a proposed improvement preserve task
> success before anyone calls it an optimization?

## Why it exists

Coding agents can accumulate provider context, tool history, requests, and
latency that are difficult to measure without replacing the agent. Inlay's
current purpose is narrower: transparently forward one validated profile and
derive bounded, content-free measurements while independently checking task
completion. Observed structural growth or recurrence is not semantic
redundancy, removability, token savings, cost savings, or latency improvement.

## The evidence-first loop

```text
transparent placement
        ↓
privacy-bounded measurement
        ↓
deterministic task verification
        ↓
research decision: test, reject, or stop
```

This is the difference between an “agent optimization” demo and an engineering
claim you can defend in a design review or technical interview.

## Current validated profiles

| Profile | Evidence | Boundary |
| --- | --- | --- |
| Codex HTTP Responses | Live C2 coding tasks completed through `POST /v1/responses` with SSE pass-through and no payload change. | One Codex CLI/provider/task profile; not general Codex support. |
| Pi experimental adapter | One Pi 0.86.0 C2 task completed through existing `openai-codex` OAuth using `POST /v1/codex/responses`. | An explicitly loaded, Pi-only adapter/profile; not general Pi or multi-harness support. |
| Pi Codex Responses alias | The narrow `POST /v1/codex/responses` compatibility alias was live-validated. | It forwards to the configured Responses upstream; it is not a general protocol layer. |

The Pi content-free cross-boundary timeline does **not** have a completed
trajectory: its latest launch exited before a supported provider request or
harness action. Its cause is intentionally unknown because the probe retains
no raw diagnostic content.

## v0.1.0 at a glance

| Ships | Does not ship |
| --- | --- |
| Transparent loopback middleware | Context pruning or request rewriting |
| Codex Responses + narrow Pi alias evidence | An agent runner or universal harness router |
| Bounded structural/zstd observation | Token, cost, latency, or tool-call reduction claims |
| Sanitized measurement infrastructure and CI | A hidden raw-payload archive |

**The result:** a small, runnable evidence baseline—not a hype-driven wrapper.

## Run the validated transport locally

Requirements: Node `>=22.15.0`, pnpm `10.11.0`, and an already authenticated supported
harness/provider profile. Inlay does not obtain, store, or configure provider
credentials.

```powershell
pnpm install --frozen-lockfile
$env:INLAY_UPSTREAM_BASE_URL = 'https://chatgpt.com/backend-api/codex'
$env:INLAY_HOST = '127.0.0.1'
$env:INLAY_PORT = '8787'
pnpm start
```

Check the loopback server with:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

For the validated Codex CLI experiment, configure Codex's existing
process-level `openai_base_url` setting to `http://127.0.0.1:8787/v1`; its
existing ChatGPT authentication continues to be owned by Codex.

The public runtime surface is loopback-only:

- `GET /health`
- `GET /metrics`
- `POST /v1/responses` — validated Codex HTTP Responses route
- `POST /v1/codex/responses` — narrow Pi compatibility alias
- `POST /v1/chat/completions` — synthetic-test-only compatibility route

`GET /v1/models` and WebSocket transport are unsupported. A harness may probe
them; that is not an Inlay fallback or a claim of compatibility. Requests are
buffered before transparent forwarding; upstream SSE bytes stream without
semantic rewriting.

## What Inlay currently measures

Structural observation is off by default. Set `INLAY_OBSERVATION=structural`
only for a named experiment. It can measure, when the supported provider emits
them:

- bounded request/response transport fields, HTTP status, lifecycle state, and
  numeric provider usage;
- approved request structure: whitelisted top-level fields, fixed item
  categories/counts, and canonical structural-byte totals;
- first upstream-header/response-byte timing and terminal-event observation;
- in explicitly loaded Pi research adapters, fixed action categories, outcomes,
  durations, and verifier class.

These are three distinct quantities:

| Measure | Definition | Interpretation |
| --- | --- | --- |
| Wire request bytes | Exact buffered request-body length received by Inlay | Transport size only |
| Compressed request bytes | Wire bytes when `Content-Encoding: zstd` | Neither decoded size nor tokens |
| Canonical structural bytes | UTF-8 bytes after recursively sorting object keys, preserving array order, then `JSON.stringify` on a transient whitelisted value | Stable local structural-size proxy; not wire bytes, provider tokens, or billing |

In plain English: Inlay can expose *structure and transport behavior*; it
cannot see whether an item is semantically redundant, whether model reasoning
is wasted, or whether a rewrite would preserve provider cache behavior.

## Local Exchange Lifecycle

`GET /metrics` now adds `exchangeLifecycle`: admitted handlers, currently active
handlers, cumulative local forwarding invocations and finalized handlers.
This can reveal pending supported work while the outcome store is empty or
stable. It is available independently of opt-in structural observation.

A terminal SSE event does not finalize a handler; the original callback must
settle normally. Counters are local to one server instance and retain no
per-request lifecycle records. They do not establish task success, provider
receipt, logical retries, complete delivery, abnormal finalization or semantic
agent stages. Cumulative forwarding cannot identify which active handler forwarded.

See the [measurement inventory](docs/measurements.md) for field definitions,
availability, concurrency, privacy and the scoped synthetic evidence.

## Privacy boundary

Inlay does not persist raw request or response bodies. Structural decoding is
transient and bounded; upstream bytes and headers are forwarded without
rewriting. The process-local `/metrics` window retains up to 100 request
records containing a generated request identifier, timestamps, approved
aggregate structure, lifecycle fields, and numeric usage when emitted. It is
not zero retention and must remain loopback-only.

Explicit Pi research adapters can write a Git-ignored, bounded local spool of
fixed categories, counts, outcomes, and durations. Research records retain
only sanitized aggregates. Neither path is designed to observe model reasoning,
semantic redundancy, tool meaning, causal dependencies, provider-internal
economics, provider-only backend latency, or model decision boundaries.

## Evidence and research status

- Context growth and exact canonical recurrence were observed in a narrow Codex
  C2 trajectory; semantic identity, necessity, redundancy, and removability
  were not established.
- ObservationPack, Evidence-Preserving Reducer, and Online Context Compaction
  are not evidence-eligible for the observed Codex trajectory.
- Action Fusion v1's experimental compound interface failed its capability
  gate and is retired as a release capability.
- The content-free cross-boundary timeline measurement gate did not pass.

The resulting position is deliberately conservative: no optimization mechanism
is currently evidence-eligible.

## Research trail, not marketing

Inlay is a first public research/measurement prototype. Its evidence is
profile- and task-specific. It makes no general multi-harness claim and no
claim of token, cost, latency, or tool-call reduction. Future work requires a
new, mechanism-specific preservation contract and successful control/treatment
evidence before a transformation is implemented.

Negative results are retained on purpose: ObservationPack,
Evidence-Preserving Reducer, and Online Context Compaction were not
evidence-eligible for the observed Codex trajectory; Action Fusion v1 failed
its capability gate; and the cross-boundary timeline measurement gate did not
pass. Those are research findings, not features quietly swept under the rug.

## Repository map

```text
src/              transparent transport, observation, and metrics
extensions/       explicitly loaded Pi research adapters
scripts/          reproducible C2 topology preflight
test/             transport, lifecycle, privacy, and topology checks
assets/           repository-owned visual identity
```

## Releases and upgrades

See [release discipline](docs/releases.md) for source-archive installation,
version decisions, compatibility notes and verification requirements.

## Development

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
git diff --check
```

CI runs the frozen install, test suite, and typecheck for every push and pull
request.

## Research provenance

The full, sanitized experimental trail lives in a separate private research
archive so this repository stays focused on a small runnable middleware
baseline. The public claims above remain intentionally narrow: routing and
bounded measurement are demonstrated for the stated profiles; semantic
redundancy, removability, token savings, cost savings, and latency improvement
are not.
