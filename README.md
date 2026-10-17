<h1 align="center">
  <img src="assets/inlay-mark.png" width="48" alt="Inlay mark" valign="middle" />
  <span>Inlay</span>
</h1>

<p align="center">
  <a href="https://github.com/pranavsinghpatil/inlay-mware/actions/workflows/ci.yml"><img src="https://github.com/pranavsinghpatil/inlay-mware/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/pranavsinghpatil/inlay-mware/releases/latest"><img src="https://img.shields.io/github/v/release/pranavsinghpatil/inlay-mware?display_name=tag&sort=semver" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" /></a>
</p>

Inlay is a loopback HTTP middleware for observing supported coding-agent
provider exchanges. It forwards request and response payloads without rewriting
them and derives bounded transport and structural measurements.

```text
coding harness → Inlay → configured upstream
```

## Release status

The latest accepted release is [v0.1.0](https://github.com/pranavsinghpatil/inlay-mware/releases/tag/v0.1.0).
The lifecycle instrumentation and SSE consistency correction on main are an
**unreleased v0.1.1 patch
candidate**. The previous v0.2.0 designation was withdrawn; its tag and artifacts
remain available only as historical records.

No optimization mechanism is released. Token, cost and latency reductions,
generalized reliability and measured developer benefit have not been established.

## Supported interfaces

| Method and path | Scope |
| --- | --- |
| `GET /health` | Local server and upstream-configuration status |
| `GET /metrics` | Process-local measurement snapshot |
| `GET /`, `GET /dashboard` | Local observation page (unreleased M2) |
| `GET /dashboard/data` | Approved presentation snapshot (unreleased M2) |
| `GET /trajectories` | Local redirect to optional trajectory observer (development) |
| `GET /v1/models` | Unobserved model-catalog pass-through (unreleased M2) |
| `POST /v1/responses` | Codex HTTP Responses profile |
| `POST /v1/codex/responses` | Narrow Pi Codex Responses alias |
| `POST /v1/chat/completions` | Synthetic-tested compatibility route |

Codex routing was validated for the recorded HTTP Responses profile.
One Pi 0.86.0 experiment validated the explicitly loaded adapter and alias.
These results do not establish general Codex, Pi or multi-harness compatibility.
The unreleased M2 candidate adds model-catalog forwarding without catalog
retention or exchange accounting. WebSocket transport remains unsupported.
See [Codex desktop HTTP setup](docs/codex-desktop.md); real desktop compatibility
requires verification after configuration and restart.

Requests are buffered within the configured body limit. Upstream response bytes,
including SSE, pass through without semantic rewriting.

## Installation and configuration

Requirements: Node `>=22.15.0`, pnpm `10.11.0`, and an authenticated supported
harness for provider forwarding. Source releases are distributed through GitHub;
Inlay is not published to npm.

To use the accepted release:

```powershell
git clone --branch v0.1.0 --depth 1 https://github.com/pranavsinghpatil/inlay-mware.git
cd inlay-mware
pnpm install --frozen-lockfile
$env:INLAY_UPSTREAM_BASE_URL = 'https://chatgpt.com/backend-api/codex'
$env:INLAY_HOST = '127.0.0.1'
$env:INLAY_PORT = '8787'
pnpm start
```

For the recorded Codex profile, configure the harness's existing
`openai_base_url` to `http://127.0.0.1:8787/v1`. Authentication remains owned by
the harness. Inlay does not obtain or persist provider credentials.

Without an upstream URL, health and metrics remain available and supported POST
routes return 503. Set environment variables in the launching process; Inlay
does not automatically load `.env` files. Configuration examples are provided
in [.env.example](.env.example).

## Measurements

The accepted v0.1.0 baseline provides bounded outcome records and optional
structural Responses observation, including approved request aggregates,
transport timing, terminal-event observation and provider-declared numeric usage.
Exact-item recurrence is separately opt-in and does not establish redundancy.

The unreleased patch candidate adds `exchangeLifecycle` to `GET /metrics`:
cumulative admitted handlers, currently active handlers, cumulative local fetch
invocations and normal callback finalizations. It can distinguish a pending
supported handler from an empty outcome store in the tested paths. It does not
attribute forwarding to individual active handlers.

See [measurement definitions](docs/measurements.md) for availability, units,
scope, retention and interpretation limits. Synthetic tests establish the stated
technical behavior; they do not establish usefulness or efficiency.

## Local observation surface (unreleased M2)

The development dashboard at `http://127.0.0.1:8787/` presents existing lifecycle,
reported usage/coverage, observation integrity, structure/recurrence and recent
approved outcomes. It polls locally every two seconds. Missing measurements stay
unavailable; no task interpretation or optimization recommendations are added.

Local history is opt-in through `INLAY_HISTORY_DIR`. It stores bounded aggregate
session summaries, never recent request rows or workload content. The default
retention is 20 sessions, configurable from 1 to 100; files are capped at 2 MiB.
See [daily-use setup and persistence boundaries](docs/local-observation.md).
This surface is development work and is not part of accepted v0.1.0.

## Privacy and retention

Raw request and response bodies are not persisted. Structural decoding is
transient and bounded. The existing metrics window retains up to 100 records
containing generated identifiers, timestamps, fixed route/category fields,
approved aggregate structure and numeric usage when observed.

The proposed lifecycle counters add fixed aggregate state without per-request
lifecycle records. Metrics remain local and must not be exposed publicly.
Explicit Pi research adapters may write bounded local metadata spools; they are
not loaded automatically.

## Evidence limits

Structural growth and exact canonical recurrence were observed in a narrow
Codex trajectory. Semantic redundancy, removability and transformation safety
were not established. ObservationPack, Evidence-Preserving Reducer and Online
Context Compaction were not evidence-eligible for that trajectory. Action
Fusion v1 failed its capability gate. The cross-boundary timeline measurement
gate did not pass. These findings apply to the studied configurations.

Unexpected observation-exception finalization remains unavailable. No
task-success, provider-receipt, logical-retry or complete-delivery inference is
supported by lifecycle counts.

Detailed protocols and research working records are maintained separately.
This repository contains runtime code, public contracts, tests and selected
evidence summaries.

## Development and releases

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
git diff --check
```

CI verifies the checkout and an extracted source archive on Node 22.15.0.
[Release requirements](docs/releases.md) describe version approval, source
verification and upgrade considerations. Passing technical checks does not
authorize publication or establish a product milestone.

## Structured agent trajectories (development)

The opt-in local Codex record reader adds turn links, tool requests/results, command exit codes, file-change reports, timings and explicit gaps. Its separate loopback viewer runs alongside the exchange dashboard. See [setup, retention and measurement boundaries](docs/agent-trajectories.md). These runtime reports do not establish independently verified task success or semantic tool quality.
