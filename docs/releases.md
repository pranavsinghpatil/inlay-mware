# Release policy

Inlay distributes source releases through GitHub. `private: true` prevents npm
publication. The latest accepted release is v0.1.0.

## Version approval

During initial development, small compatible maintenance and instrumentation
updates remain within the 0.1.x line. A minor-version increase requires an
explicitly approved product milestone with evidence proportionate to its claim.
Test counts and technical correctness alone do not establish that milestone.

The lifecycle instrumentation update is proposed as **v0.1.1**, pending release
approval. It does not add an optimization or establish measured developer benefit.

The previously published v0.2.0 designation has been withdrawn. Its tag and
artifact bytes are retained as historical records, and its release entry is
excluded from the accepted release channel. Tags and published artifacts must
not be moved, overwritten or silently relabeled.

## Publication requirements

1. Agree the release scope and proposed version before publication.
2. Review the exact changes, compatibility, configuration, public documentation
   and known limitations. Resolve review blockers and pass applicable CI.
3. Validate the final source commit as an extracted archive: frozen installation,
   complete tests, typecheck and provider-free CLI startup on the supported Node
   baseline.
4. Verify the archive, provenance record and checksums against that exact commit.
5. Obtain explicit approval to publish the proposed version. Create its tag and
   upload the same verified bytes; verify the published downloads.

A passing candidate remains unreleased until publication is approved. Changes
after verification require a new candidate check. Release notes must state the
change, compatibility, verification and limitations in factual terms.
Internal research decisions and speculative roadmap claims belong in private
working documentation.

## Installation

Use Node `>=22.15.0` and pnpm `10.11.0`. CI checks Node `22.15.0` on Linux.
The source distribution includes the lockfile and requires development
dependencies for its source execution and verification tools.

The accepted v0.1.0 release has no separately attached verification assets.
Install from its tag using the [README instructions](../README.md). For future
approved releases with attached source archives, verify the supplied
`SHA256SUMS`, extract the archive and run:

```sh
pnpm install --frozen-lockfile
pnpm start
```

Set configuration in the launching environment; `.env` files are not loaded
automatically. Without an upstream URL, health and metrics work and supported
POST requests return 503. Authentication remains owned by the harness.

## Proposed patch compatibility

The lifecycle update requires no configuration or storage migration.
`/metrics.exchangeLifecycle` is additive and always on; clients that enforce
exact JSON keys must accept the new property. Counts reset with the server
instance. Existing outcome fields, dependencies and retention are unchanged.

Unexpected observation-exception finalization remains unavailable. Aggregate
forwarding cannot identify which active handler forwarded. No task, retry,
provider-receipt, efficiency or measured user-benefit claim is established.
