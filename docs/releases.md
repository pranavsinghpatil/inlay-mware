# Releases

Inlay distributes GitHub source releases. `private: true` prevents npm
publication; a release is not an npm package or a general harness-support claim.

## Version decisions

The first release was `v0.1.0`; it had no written increment policy. From
`v0.2.0`, use [Semantic Versioning](https://semver.org/) numbering with this
explicit initial-development convention:

- Increase the minor version for a meaningful new capability or an incompatible
  contract change. Describe any incompatibility and migration in the notes.
- Increase the patch version for compatible corrections and documentation fixes.
- Keep the major version at zero until a reviewed stable public contract exists.
- Never move or rewrite a published tag or replace its artifact bytes.

LEA-3 adds a compatible metrics property and a new diagnostic capability.
The LEA-3 version decision assigns `v0.2.0`, rather than a patch to the
`v0.1.0` evidence baseline.

## Release gate

One active milestone ends in a reviewed PR and a release record. Before tagging:

1. Review the exact commit, changed files, open review threads and applicable
   repository rules. Resolve blockers within scope; require passing CI.
2. Review runtime/configuration/API compatibility, Node support, installation,
   documentation, upgrade notes and evidence limits.
3. On the final main commit, CI must archive tracked source, extract it into a
   fresh directory, install with the frozen lockfile, and pass the complete test
   suite, typecheck and unconfigured CLI startup smoke. No provider is contacted.
4. Download that run's source archive, `release-verification.json` and
   `SHA256SUMS`. Verify checksums, exact source commit, version and successful
   checks before publication. Attach those same bytes to the GitHub release.
5. Create the tag at that verified commit. Record delivered value, evidence,
   limitations and milestone decision in the release notes; verify the published
   tag and downloadable checksums. Do not claim publication before it succeeds.

CI candidate artifacts are temporary validation outputs, not published releases.
A failed gate means HOLD FOR CORRECTION; no tag or publication. Any change to the
candidate commit requires verification of a new archive.

## Install and upgrade

Use Node `>=22.15.0` and pnpm `10.11.0`. CI tests Node `22.15.0` on Linux.
The release includes TypeScript source, tests and the lockfile; install
development dependencies because Node executes source directly.

Download the source archive and `SHA256SUMS` from the selected release. Verify
its SHA-256, extract it, then run from the extracted `inlay-VERSION/` directory:

```sh
pnpm install --frozen-lockfile
pnpm start
```

Without `INLAY_UPSTREAM_BASE_URL`, health and metrics work and supported POST
routes return 503. For forwarding, supply the existing upstream configuration
described in the [README](../README.md). Inlay does not read `.env` files
automatically; set variables in the launching process. Harness authentication
remains owned by the harness.

Upgrading from `v0.1.0` requires no configuration or storage migration.
`/metrics.exchangeLifecycle` is additive and always on; clients enforcing exact
JSON keys must accept the new field. Counters reset with the server instance;
old outcome fields and retention keep their meanings. Never use a zero or a
missing field to stand in for `UNAVAILABLE`.

A new build or experiment requires a demonstrated need and explicit scope.
The current recommendation is limited field validation of the shipped
pending-work diagnostic, with no new telemetry or study started automatically.
