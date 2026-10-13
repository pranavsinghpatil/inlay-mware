# Measurement inventory

The lifecycle counters described here are implemented on main and proposed
for the unreleased v0.1.1 patch. They are not part of the accepted v0.1.0
release. The v0.2.0 designation was withdrawn.

`GET /metrics` exposes local measurements. Existing outcome records, structural
observation, recurrence, usage and Pi measurements keep their v0.1.0 meanings.

| Surface | Meaning and boundary |
| --- | --- |
| `totalRequests`, `totalRequestBytes`, `recent` | Calls to the outcome store and their recorded body-byte totals; at most 100 recent records. These are not admission or active-handler counts. Missing upstream configuration returns before recording an outcome. |
| Request transport fields | Buffered body length, route, local timestamp, elapsed milliseconds, upstream HTTP status and fixed error category where recorded. No provider receipt or task result follows from them. |
| Responses observation | Opt-in structural request aggregates, first-header/body-byte timing, observed response-byte totals, terminal-event and transport completion/cancellation flags, and numeric provider usage when emitted. Parser limits and malformed/unsupported input can make observation unavailable or incomplete. |
| Exact-item recurrence | Opt-in, bounded aggregate canonical recurrence within the tracker lifetime. This does not establish semantic redundancy, necessity or removability. |
| Experimental timeline and Pi adapters | Existing opt-in local timestamps and fixed action categories/outcomes. The cross-boundary timeline measurement gate did not pass; retry classification remains unavailable. |
| `exchangeLifecycle` | Always-on, bounded supported-handler accounting, defined below. Independent of structural observation and the outcome window. |

## Local Exchange Lifecycle

An empty or stable outcome store can coexist with pending supported handlers.
Inspect `exchangeLifecycle.active` to observe that condition, provided
`availability` is `AVAILABLE`. The aggregate describes local boundaries:

```text
admitted → active → forwarding (if invoked) → finalized
```

A handler can finalize without forwarding. These are counters and a gauge,
not a per-request stage record.

### Fields and boundaries

| Field | Definition | Unit / kind |
| --- | --- | --- |
| `admitted` | Supported matched callback entries since server creation. Admission also begins the active interval. | Handlers, cumulative |
| `active` | Admitted handlers whose original callback promise has not fulfilled at the measured settlement boundary. | Handlers, instantaneous gauge |
| `forwarding` | Actual local upstream `fetch` invocations, counted after all call arguments are evaluated and immediately before invoking the captured function. | Invocations, cumulative |
| `finalized` | Original callback promise fulfillments, including handled failures and early returns. | Handlers, cumulative |
| `availability` | `AVAILABLE` when accounting is representable and consistent; otherwise `UNAVAILABLE`. | Fixed enum |
| `incomplete` | `false` for available accounting; `true` after accounting becomes unavailable. An active stream alone does not make accounting incomplete. | Boolean |
| `unavailableReason` | `null` when available; otherwise the first fixed reason: `overflow`, `invalid_transition` or `callback_rejection`. | Fixed enum or null |

The exact supported matches are POST requests to `/v1/responses`,
`/v1/codex/responses` and `/v1/chat/completions`. Health, metrics, unsupported
methods and unmatched URLs are excluded. Counting the compatibility route does
not establish live-provider compatibility.

**Scope and lifetime:** one `createInlayServer` instance in one process, starting
at zero on creation. The normal server owns one such instance. Multiple instances
have separate accounting even if given a shared outcome store. Counts are not
persistent and do not establish continuity across restarts.

**Streaming and errors:** a terminal SSE event does not finalize a handler.
It stays active while its original callback lifecycle remains open. Normal
callback fulfillment after an upstream failure, body rejection, missing
configuration or controlled disconnect can finalize it; this does not establish
delivery or task success.

**Availability:** if a safe-integer counter would overflow, an aggregate invariant
fails, or the original callback promise rejects, all four numeric fields become
`null`, with `UNAVAILABLE` and `incomplete: true`. This state is sticky for the
instance. Null is not zero. The rejection guard does not recover the callback or
count it as finalized. Unexpected observation-exception finalization and callback
rejection preservation remain **UNAVAILABLE**; the excluded exception path has
not been validated. Process survival or a subsequent metrics response after
a callback rejection is not guaranteed.

**Concurrency:** each admitted handler contributes to aggregate counts, without a
single current-request slot. Within available accounting:

```text
admitted = active + finalized
0 <= forwarding <= admitted
```

These quantities are related, not statistically independent. A cumulative
forwarding count cannot attribute an invocation to a particular active handler.
With mixed concurrent or historical work, these scalars cannot establish which
pending handler has crossed forwarding.

**Privacy:** the added state retains four numeric scalars and a fixed reason,
without per-request records, paths, identifiers, credentials, request bodies or
SSE content. Existing outcome-window retention remains unchanged.

**Interpretation limits:** these fields do not establish task success/failure,
provider receipt, logical retries, semantic agent stages, complete response
delivery, abnormal finalization, generalized reliability, performance or
efficiency, or user-facing usefulness.

### Evidence and regression coverage

The scoped LEA-2 synthetic experiment on unchanged v0.1.0 matched seven included
cases, including three controlled disconnect trials and reversed concurrent
completion. It demonstrated local accounting behavior for those paths.
Unexpected observation-exception finalization was excluded and remains
unavailable. The frozen protocol and detailed results remain in the canonical
private research archive; this document is the public measurement summary.

Production [integration tests](../test/exchange-lifecycle.test.ts) cover normal
exchange, upstream failure, pre-forward rejection, missing configuration, held
streaming, controlled disconnect and reversed concurrent completion. They check
the existing outcome fields alongside the new counters. Additional checks cover
route exclusion, separate server lifetimes and conservative unavailable states.
The existing [release tests](../test/) continue to cover transport, observation,
privacy, recurrence and topology. Synthetic behavior checks do not demonstrate
report usefulness or efficiency.

## SSE observation consistency

The unreleased patch corrects chunk-dependent observation loss in the existing
Responses observer. Regression checks compare identical synthetic bytes delivered
whole, byte by byte, at event/data/JSON boundaries and in mixed partitions. They
include a 78,140-byte stream of small frames. Only first-body-byte and terminal
arrival timings are excluded from snapshot equality.

The existing limit is 65,536 UTF-16 code units per reconstructed frame, including
its blank-line delimiter. LF and CRLF delimiters and split UTF-8 characters are
covered. An oversized frame is discarded through its delimiter; subsequent
bounded frames can be observed, while `responseObservationIncomplete` stays true.
Normal finish with an unfinished frame also sets that flag. On interruption,
the existing snapshot path does not finalize the parser; `false` therefore does
not establish exhaustive observation. Missing usage is not zero.

[Focused regressions](../test/responses-stream.test.ts) exercise partition equality,
usage merging, terminal recognition, malformed data, unfinished input and the
exact size limit. They establish behavior for these supported synthetic paths,
not arbitrary SSE compatibility, response completeness, provider correctness,
task success, performance or savings. Bare-CR framing remains unsupported.
Forwarded bytes, configuration, observation fields and event interpretation are
unchanged.

## Local presentation and aggregate history (unreleased M2)

The [local observation surface](local-observation.md) presents these existing
measurements without changing `/metrics`. Its separate endpoint provides derived
server-instance rollups and up to 20 allowlisted recent rows. Optional disk history
contains aggregate session checkpoints only, with field-level coverage and fixed
availability/incomplete flags. No request rows or workload content are persisted.
Session boundaries do not identify tasks or harness sessions. Existing measurement
interpretation limits apply to the UI and persisted aggregates equally.
