# Local observation surface

Status: unreleased M2 development work. This surface does not change the accepted
release designation or the existing `/metrics` contract.

## Open the dashboard

Start the source checkout containing M2, then open `http://127.0.0.1:8787/` or
`http://127.0.0.1:8787/dashboard`. The same loopback service serves the page and
its assets; no separate frontend build, account or internet connection is needed.
Existing harness routing and authentication stay unchanged. The dashboard uses a
dark theme with section navigation and a responsive activity layout. The compact overview prioritizes runtime
counts; usage totals show field coverage alongside values.
Integrity, recurrence, response flags and saved session details expand on demand.
Scope and setup guidance explains routing, retention and measurement limits.
Saved session disclosures retain their open state and focus across checkpoints.

Only traffic explicitly routed through Inlay is observed. Keeping the service
running does not discover other open coding agents. Multiple clients using the
same instance contribute to combined totals without client attribution. General
multi-client compatibility and WebSocket transport are not established.

The page polls `GET /dashboard/data` every two seconds after the preceding poll
settles. Failed polls retain the last successful view with an explicit stale
notice. Data and assets use no-store responses and a self-only content policy.
Dashboard routes reject foreign browser origins and non-loopback Host headers.
Existing health, metrics and provider routes retain their behavior.

## Existing measurements presented

- Server-instance lifecycle: admitted, active, actual local forwarding invocations
  and normally finalized handlers, with existing availability and incomplete state.
- Sums and per-field coverage for encountered reported input, output, total and
  cached-input usage. Zero is retained; an absent field is missing, not zero.
- Recorded request/observed response bytes, transport flags and their availability.
- Canonical structural bytes, input counts/composition, fixed unavailable reasons,
  and exact recurrence counts/bytes and limit flags where enabled.
- The latest 20 approved outcome summaries from the existing 100-row memory window,
  without request identifiers, per-request timestamps or arbitrary strings.

Session rollups consume existing `MetricsStore.record` outcomes before window
retention removes old rows. They are derived aggregates, not additional upstream
instrumentation. They cover records received after this server instance was
created. A session is one `createInlayServer` lifetime, not a harness session,
project, task or conversation. Production starts with a fresh outcome store.
If applications deliberately share a store, rollups describe its writes while
attached; lifecycle remains per server and cannot attribute shared records.

Coverage denominators count recorded outcomes, including paths without structural
observation. They do not count all ingress or logical requests. Body-read failures
retain the existing zero-byte placeholder. Unsupported routes and unconfigured
upstream responses do not create outcome records. Lifecycle can therefore show
activity absent from outcome totals.

Enable existing observation modes only when needed:

```powershell
$env:INLAY_OBSERVATION = 'structural'
# Optional, using the existing bounded recurrence observer:
$env:INLAY_RECURRENCE_PROBE = 'exact-item'
pnpm start
```

Structural observation still applies only to supported Responses routes. Timing,
usage, terminal and incomplete values retain their [existing meanings](measurements.md).
Usage sums are encountered provider-reported values over the recorded population,
not verified final accounting, bills or task totals. The UI does not rank runs or
recommend optimizations. Structural bytes are not tokens, and recurrence is not
semantic redundancy or removability. Incomplete=false is not exhaustive coverage.

## Opt-in local aggregate history

Persistence is off by default. Select a dedicated local directory to enable it:

```powershell
$env:INLAY_HISTORY_DIR = '.inlay/history'
$env:INLAY_HISTORY_MAX_SESSIONS = '20'
pnpm start
```

`INLAY_HISTORY_MAX_SESSIONS` defaults to 20 and accepts integers 1 through 100.
The directory is resolved by the operating system from the launching process;
it is never included in dashboard data or stored summaries. `.inlay/` is ignored
by this repository. Use a private directory; metadata still reveals activity.

Only `inlay-history.json` is durable history. It contains a version and bounded
session summaries: an opaque local aggregate-session UUID, server start/update/
known-end timestamps, running/closed/end_unknown state, approved numeric rollups,
coverage, fixed availability reasons, lifecycle snapshot and recurrence summary.
The UUID belongs only to that aggregate record; it is never added to requests,
headers, existing outcome records or provider traffic. Dates are stored in UTC
and displayed in the browser's local time.

Recent outcome rows, request IDs, per-request timestamps/durations, routes,
recurrence fingerprints/group details, timeline events, upstream/configuration
URLs, local paths, prompts, source, tool output, commands, arbitrary headers,
credentials, bodies, SSE and raw logs are not persisted. No browser storage,
remote storage, cloud telemetry or raw event explorer is added.

The service checkpoints every five seconds without requiring an open browser,
and flushes on normal server close. SIGINT/SIGTERM request a normal close. The
current session counts toward retention. Lowering retention keeps the newest
summaries. Each file/read/write is capped at 2 MiB; one serialized write and one
coalesced latest update bound pending work. Writes replace a private temporary
file atomically. POSIX files use mode 0600; Windows inherits directory access
controls. History is local plaintext, not an encrypted backup or crash-proof log.

Abrupt termination can lose changes after the last successful checkpoint. A prior
running record becomes `end_unknown` on reload, with no invented end timestamp;
it does not mean task failure. An exclusive empty `inlay-history.lock` prevents
concurrent writers. A stale lock requires the operator to stop all instances
using that directory, remove only that lock, then restart. Never remove a live
writer's lock. `inlay-history.tmp` is reserved for the writer and may remain after
interruption; it is not another history archive.

Invalid, oversized or unrecognized history is rejected without displaying or
rewriting it. Locked/storage-failure states expose fixed reasons only, without
filesystem paths or raw exception text. A storage failure does not stop proxy
forwarding; historical summaries are explicitly unavailable. Unexpected rollup
failure makes the dashboard data unavailable rather than publishing incomplete
totals as valid; existing metrics and proxy paths continue independently.

## Data endpoint and limits

`GET /dashboard/data` is a separate version-1 presentation endpoint containing
`modes`, `current`, `recent`, `history`, `refreshMs` and `checkpointMs`. Current
and history summaries use a closed schema. Numeric coverage has `sum`, `available`
and `missing`; transport flags have `yes`, `no` and `unavailable`. A null sum with
available observations can also indicate an unrepresentable aggregate, not zero.
History reports `off`, `ready` or `unavailable` with a fixed reason. Stored running
summaries are last checkpoints and can lag the live view; historical rows are
shown newest first by default, across the bounded retained window (at most 100),
with the matching count and configured retention limit.

No task success, provider receipt, logical retry, whole-run capture, cross-session
item identity, cost savings or measured developer benefit follows from this UI.
The purpose is to inspect existing evidence during daily use. Technical tests
validate mapping, refresh, privacy, retention and compatibility; real-world value
remains to be learned through use.


## Filters and aggregate exports

Recent filters select route, reported input-usage availability and existing
transport flags within the latest 20 outcome rows. Flags can overlap; completed
means the existing completed flag is true, not task success. Missing input usage
is distinct from a reported zero. Filtering does not recalculate session totals.
Saved-session filters select state and inclusive start dates in UTC, with newest
or oldest ordering, across all retained summaries. No-match and no-data states
are distinct. Reversed date ranges are identified explicitly.

Export JSON or CSV downloads unfiltered current aggregates and the selected
saved-session aggregates through a fixed allowlist. The saved checkpoint for the
current session is omitted to avoid duplicating it. Both formats include usage
coverage, lifecycle, transport, structural and recurrence aggregates, history
availability, selection metadata and export time. CSV uses blank cells for null
or unavailable values; coverage columns preserve their meaning. Offline exports
are marked stale. A saved running session is only its last checkpoint.

Recent rows, request/session identifiers, prompts, source, tool output, raw
requests/responses, headers, credentials, configuration URLs and local paths are
excluded. The exported file is a deliberate user-selected local copy of approved
aggregates; it is not a transcript, task total, billing record or cloud upload.
The export scripts and existing project logo are served by the guarded dashboard
routes, without dependencies or a new provider observation boundary.

## Continuous local operation

Inlay observes compatible HTTP traffic explicitly routed through its configured
upstream. Keeping it running, including through a local Windows sign-in task,
does not observe this chat, discover other applications, establish per-agent
identity or cover WebSocket/model-discovery routes. Enable aggregate history
before starting it, then verify admitted and recorded outcome counts during a
normal client session before claiming real-data collection. A healthy dashboard
alone does not verify client routing or provider receipt.

A local startup task is operator configuration, not a released universal-agent
integration. Use a pinned, verified source checkout, a dedicated history directory
and the existing credential-owning client. Automatic startup cannot guarantee
availability while the machine is off or asleep. Preserve the stale-lock recovery
rule above rather than silently deleting a lock on restart.
