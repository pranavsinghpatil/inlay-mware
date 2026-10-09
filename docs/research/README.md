# Research evidence ledger

This ledger summarizes the sanitized studies included in the
[v0.1.0 source snapshot](https://github.com/pranavsinghpatil/inlay-mware/tree/v0.1.0/docs/research).
The links below point to individual records at that immutable tag. The table
keeps study validity, the supported finding and scope, and release eligibility
separate. A negative or inconclusive result applies only to the stated study
and profile.

The new [evidence-readiness calibration](../../research/evidence-readiness/v1/README.md)
records 24 matching synthetic measurement projections. The [post-calibration
review](../../research/evidence-readiness/v1/report.md) identifies a protocol
nonconformance, so the overall calibration gate is not established. No
live-provider run, participant pilot, or production report was created.

## Profile and measurement studies

| Study record | Study validity | Finding and scope | Current release eligibility |
| --- | --- | --- | --- |
| [Codex C2 clamp baseline](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/c2-codex-clamp-baseline.md) | Completed baseline and validation runs | Transparent routing and task verification were observed for the named Codex C2 fixture. The fixture is a development/regression smoke test, not independent optimization evidence. | No transformation eligibility established. |
| [Codex trajectory probe](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/c2-codex-trajectory-probe.md) | Completed for the recorded task | The trajectory did not show a recognized recurring tool-result item; it does not establish that such recurrence never occurs. | ObservationPack and reducers remain unassessed by this result. |
| [Exact-item recurrence](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/c2-codex-exact-item-recurrence.md) and [semantic-role inspection](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/c2-codex-semantic-role-inspection.md) | Completed for the recorded Codex C2 trajectory | Exact canonical recurrence and structural growth were observed. Semantic identity, necessity, redundancy, and removability were not established. | No item transformation is eligible on this evidence. |
| [ObservationPack clamp study](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/observationpack-eligibility-c2-clamp.md) | Inconclusive: fewer valid repetitions than the protocol gate required | The valid repetitions did not consistently expose a recognized tool-output item type. This does not establish ineffectiveness beyond this fixture and sample. | Not eligible for a transformation experiment on this study. |
| [Evidence-Preserving Reducer study](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/evidence-preserving-reducer-eligibility.md) | Completed observation and eligibility assessment | No candidate met the study's evidence-preservation conditions; removability remained unknown for the observed items. | Not eligible for this Codex trajectory. |
| [Online Context Compaction study](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/online-context-compaction-eligibility.md) | Completed observation and eligibility assessment | Context accumulated, but the study found no defensible content-free supersession signal. Accumulation alone does not establish stale or removable state. | Not eligible for this Codex trajectory. |
| [Pi transport compatibility check](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/pi-c2-transport-compatibility-check.md) and [valid baseline](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/pi-c2-valid-baseline.md) | Compatibility check and one baseline task completed | The narrow Pi 0.86.0 Responses alias passed the recorded transport check; one task passed its verifier and scope checks. | Establishes only the named alias/profile baseline, not a transformation. |
| [Cross-boundary timeline, initial attempt](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/content-free-cross-boundary-timeline.md) | Attempt did not produce a completed trajectory | The historical run is a protocol/launch boundary observation, not task outcome evidence. | No measurement gate passed. |
| [Cross-boundary timeline, final attempt](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/content-free-cross-boundary-timeline-final.md) | Latest attempt ended before a supported provider request or harness action | No completed trajectory or task-completion evidence was available; the cause remained unknown under the privacy boundary. | Measurement gate did not pass. |

## Action Fusion studies

| Study record | Study validity | Finding and scope | Current release eligibility |
| --- | --- | --- | --- |
| [Feasibility protocol](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/action-fusion-feasibility-protocol.md) and [Pi feasibility cell](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/pi-action-fusion-feasibility.md) | Feasibility observation completed | One Pi adapter/task exposed an edit-to-verifier adjacency. This supports a constrained pilot question for that adapter and task. | No release eligibility established. |
| [Controlled pilot 1](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/pi-action-fusion-controlled-pilot.md) | Invalidated: treatment interface contract defect | The treatment omitted an exact-once requirement; its result must not be pooled with the revised pilot. | No valid capability or efficiency result from this pilot. |
| [Pilot 2](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/pi-action-fusion-pilot2.md) | Valid capability-gate stop for the frozen task configuration | The treatment was rejected before an edit was committed. This result is limited to the tested interface and task. | Action Fusion v1 is not a release capability. No general infeasibility claim follows. |

## Protocols and templates

These records define study procedures or reusable record formats; they are
not independent outcome evidence:

- [ObservationPack eligibility protocol](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/observationpack-eligibility-protocol.md)
- [Exact-item recurrence probe](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/exact-item-recurrence-probe.md)
- [Semantic-role inspection protocol](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/semantic-role-inspection-protocol.md)
- [Experiment record template](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/research/experiment-record-template.md)

## Current release position

The v0.1.0 evidence supports transparent routing and bounded measurement for
the named profiles. It does not establish semantic redundancy, safe removal,
token or cost savings, or general support across harnesses. No optimization
mechanism is currently eligible for release on the cited evidence.

For runtime boundaries and privacy details, see the [documentation index](../README.md)
and the [v0.1.0 interaction model](https://github.com/pranavsinghpatil/inlay-mware/blob/v0.1.0/docs/architecture/interaction-model.md).
