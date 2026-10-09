<h1 align="center">
  <img src="assets/inlay-mark.png" width="48" alt="Inlay layered middleware mark" valign="middle" />
  <span>Inlay</span>
</h1>

<p align="center">
  <a href="https://github.com/pranavsinghpatil/inlay-mware/actions/workflows/ci.yml"><img src="https://github.com/pranavsinghpatil/inlay-mware/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/pranavsinghpatil/inlay-mware/releases/tag/v0.1.0"><img src="https://img.shields.io/github/v/release/pranavsinghpatil/inlay-mware?display_name=tag&sort=semver" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" /></a>
</p>

Inlay is local middleware for observing selected coding-agent provider traffic
and measuring bounded, content-free transport and request structure. It
forwards requests to the configured provider while the existing harness
continues to run the agent and own its authentication.

```text
coding harness → Inlay → configured provider
```

Inlay is not an agent runner or a request-transformation system. Its current
release provides transport observation; optimization mechanisms remain
research questions.

## Validated profiles

| Profile | Observed result | Scope |
| --- | --- | --- |
| Codex HTTP Responses | C2 tasks completed through `POST /v1/responses` with SSE pass-through and unchanged request payloads. | Evidence covers the observed Codex CLI, provider, and task profile. |
| Pi Responses alias | The `POST /v1/codex/responses` compatibility alias passed transport validation for Pi 0.86.0 using its existing `openai-codex` OAuth flow. | A narrow route and profile; this does not establish general Pi or multi-harness support. |
| Pi action adapter | One Pi 0.86.0 C2 task completed with the explicitly loaded research adapter. | Adapter-specific evidence; it does not establish general action lifecycle support. |

The latest content-free cross-boundary timeline attempt ended before a supported
provider request or harness action. The cause was not recorded because the
probe does not retain raw diagnostic content.

## Run locally

Requirements: Node `>=22.15.0`, pnpm, and an already authenticated supported
harness/provider profile. Inlay does not obtain, store, or configure provider
credentials.

```powershell
pnpm install
$env:INLAY_UPSTREAM_BASE_URL = 'https://chatgpt.com/backend-api/codex'
$env:INLAY_HOST = '127.0.0.1'
$env:INLAY_PORT = '8787'
pnpm start
```

Check the loopback server with:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

For the validated Codex CLI profile, configure its existing process-level
`openai_base_url` setting to `http://127.0.0.1:8787/v1`. Codex continues to
manage its existing ChatGPT authentication.

The loopback runtime exposes:

- `GET /health`
- `GET /metrics`
- `POST /v1/responses` for the validated Codex HTTP Responses route
- `POST /v1/codex/responses` for the narrow Pi compatibility alias
- `POST /v1/chat/completions` for synthetic tests only

`GET /v1/models` and WebSocket transport are unsupported. Requests are buffered
before forwarding; upstream SSE bytes pass through without semantic rewriting.

## Measurements and limits

Structural observation is disabled by default. Set
`INLAY_OBSERVATION=structural` for a named experiment. When available, Inlay can
record bounded transport fields, HTTP status, lifecycle state, numeric provider
usage, approved request structure, and timing to upstream headers or the first
response byte. Explicit Pi research adapters can record fixed action categories,
outcomes, durations, and verifier classes.

Wire request bytes, compressed request bytes, and canonical structural bytes
are separate measurements. They describe transport size or a local structural
size proxy; they do not establish token counts, billing, or savings.

## Privacy boundary

Inlay does not persist raw request or response bodies. Structural decoding is
transient and bounded, and forwarded bytes are not rewritten. The process-local
`/metrics` window retains up to 100 request records with generated request IDs,
timestamps, approved aggregate structure, lifecycle fields, and numeric usage
when emitted. This is limited retention, not zero retention, and the endpoint
is loopback-only.

Explicit Pi research adapters can write a bounded, Git-ignored local spool of
fixed categories, counts, outcomes, and durations. Sanitized research records
omit raw content. These measurements do not expose semantic redundancy,
causality, provider-internal economics, backend-only latency, or model decision
boundaries.

## Evidence status

The available evidence is limited to the named profiles and study tasks.
Context growth and exact canonical recurrence were observed in a Codex C2
trajectory; semantic identity, necessity, redundancy, and removability were
not established. ObservationPack, Evidence-Preserving Reducer, and Online
Context Compaction are not evidence-eligible for that observed trajectory.
The Action Fusion v1 treatment failed its capability gate for the frozen pilot
configuration. The cross-boundary timeline measurement gate did not pass.

No optimization mechanism is currently evidence-eligible for release. The
[research ledger](docs/research/README.md) links the historical studies and
states the scope of each result. The [evidence-readiness calibration
review](research/evidence-readiness/v1/report.md) records 24 matching synthetic
measurement projections and a protocol nonconformance. Its overall gate is
not established. No live-provider run, participant pilot, or production report
was created.

## Documentation and development

See the [documentation index](docs/README.md) for project and research records.

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
git diff --check
```

CI runs the frozen install, test suite, and typecheck for pushes and pull
requests.
