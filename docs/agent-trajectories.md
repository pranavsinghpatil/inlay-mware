# Local Codex trajectory observations

This opt-in source capability adds structured Codex runtime observations alongside
the HTTP exchange observer. It reads existing local session records; it does not
change agent requests, call a provider, execute commands, or capture other clients.
It is an unreleased development capability, not a general Codex compatibility claim.

## Start and use

From this source checkout with Node >=22.15.0:

```powershell
$env:INLAY_TRAJECTORY_DIR = 'D:/private-inlay/trajectories'
pnpm observe:codex
```

Open <http://127.0.0.1:8788/>. The existing proxy remains on its own port, normally
8787. No proxy restart or history migration is required. Stop with Ctrl+C and allow
normal shutdown to finish before restarting the observer.

| Setting | Default and meaning |
| --- | --- |
| `INLAY_CODEX_RECORDS_DIR` | `sessions/` under `CODEX_HOME`, or `~/.codex/sessions`; explicit local JSONL source |
| `INLAY_TRAJECTORY_DIR` | `~/.inlay/trajectories`; dedicated private metadata archive, separate from source |
| `INLAY_TRAJECTORY_PORT` | `8788`; service always binds `127.0.0.1` |
| `INLAY_TRAJECTORY_MAX_BYTES` | `536870912` (512 MiB); reaching the cap stops recording, without eviction |

Previously existing supported records are projected first, then appended records
are followed. Catch-up is progressive and visible. The selected root excludes
Codex's separate archived-session directory unless explicitly selected. The
observer does not recover source records already removed by another application.

## Recorded evidence

Each event retains a closed schema, with explicit nulls for unavailable fields:

- Local pseudonymous session, numeric turn/action links and durable recorded order.
- Turn starts, agent-reported completion and aborts; completion is unverified.
- Tool requests and returned results, including argument/result JSON byte counts.
- Structured command execution reports, explicit exit codes and reported duration.
- File-change runtime status and number of changed files, without paths or diffs.
- Message/subagent activity markers, without their text or original agent IDs.
- Declared model/effort from an exact allowlist; other models are labeled `other`.
- Relative source elapsed time, available duration and fixed observation gaps.

The adapter consumes `event_msg` task/item events, `turn_context`, and supported
`response_item` call/result records. Other record types are omitted and counted
in the process coverage view. Local source formats can change; missing events
remain unavailable. Original IDs are used only transiently for matching. Session
pseudonyms use a domain-separated hash of the source filename's random UUID;
they are stable local linkage, not anonymity against someone with the source files.

Tool request/result joins use original call IDs transiently. Turn association for
call records is used only with one known active turn. Ambiguous joins are null.
Wrapper tool calls, runtime actions and agent-activity markers are separate
populations and must not be summed into unique tool executions. Runtime completion
deduplication covers a bounded recent ID window, not arbitrary duplicate history.

Command exit zero means runtime-reported execution success. A nonzero exit can
be intentional, and neither value establishes tool suitability or task correctness.
A returned result is not successful execution. A completed turn is not a passing
independent task verifier. Task verification, semantic tool quality, retry identity,
causal dependencies and links to proxy exchanges remain unavailable.

## Retention, bounds and recovery

Only projected metadata is appended; original prompts, messages, reasoning text,
commands/arguments, paths, diffs, result bodies, original IDs, exact source times,
request/SSE captures and credentials are not copied. No content digests are exported.
Byte counts describe JSON representation, not tokens or information content.

Saved events are not automatically evicted. The reader uses bounded chunks,
256 KiB source lines, bounded transient correlation maps, a 10,000-source limit
and a per-poll byte budget. Oversized/malformed records produce fixed gap events;
unsupported records contribute to a separate process count. Partial source lines
wait for a newline and are visible in coverage; normal shutdown records an
incomplete-tail marker. Truncation or replacement pauses the affected source.
Discovery and source failures are visible. No mechanism promises whole-run capture.

On restart, the original source prefix is replayed transiently to reconstruct
ordinal links; persisted source offsets prevent appending the same projected
records twice. This assumes append-only source files. Same-size content rewrites
before a restart are not independently detected. Lost source prefixes cannot be
reconstructed from metadata.

Archive validation is strict. A malformed/torn metadata journal, I/O failure,
disk cap or exclusive-writer conflict is explicitly unavailable; existing data
is preserved, without silently resetting or overwriting it. An `observer.lock`
file is removed on normal close. After a crash, confirm that no observer owns the
archive before removing a stale lock. Preserve a damaged archive for diagnosis;
the service does not repair it automatically or silently discard its tail.

The viewer exposes same-origin, loopback-only read APIs: `/data` (100 session
summaries per page) and `/events?session=<pseudonym>&after=<sequence>` (200 events
per page). `/health` describes the local store, not complete capture. API responses
do not contain source paths or source payloads. Keep the archive private even
though it contains only metadata.

The viewer initially follows the latest 200 events. Choose From start and More events
for historical pages, or Latest events to resume live following. Session pagination
has a separate Refresh sessions control; coverage and totals keep updating while
historical pages are open. The proxy dashboard's Agent trajectories link uses the
default local port 8788; open the configured port directly when using a different one.

Source files are expected to stay at stable paths under the selected root. Duplicate
UUIDs at different paths are reported as limited discovery and are not merged.
A moved source is not automatically rebound to an existing trajectory. Source and
archive locations are checked for both lexical and physical overlap before startup.
