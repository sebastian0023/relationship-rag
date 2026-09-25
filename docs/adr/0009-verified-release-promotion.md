# ADR 0009: Promote verified executable assets with explicit operational evidence

Status: Accepted

## Context

Production launch needs real AWS acceptance and RAG evidence, human operational review, and a
recoverable deployment. Fixture validators and mocked local journeys cannot certify a live release.
The public repository must not retain production configuration or private content in CI artifacts.

## Decision

Build Lambda and frontend assets once and seal them in a versioned SHA-256 manifest. CDK accepts a
release-assets context that replaces bundling with those assets while retaining the same function
construct IDs and runtime settings. Synthesize stage-specific infrastructure separately. Production
approval reviews the concrete private diff and assembly; deployment verifies the assembly digest and
does not synthesize again. Store bundles, assemblies and operational evidence in private versioned S3.

Require all automated gates and an explicit, candidate-bound operational attestation. Retain only
allowlisted metrics/outcomes in public reports. Keep live test content synthetic and disable browser
capture of authentication and application data. Protect production through GitHub required reviewers
with administrator bypass disabled. Final release tagging follows explicit onboarding acceptance and
24 hours of observation.

## Consequences

There are operator prerequisites for OIDC, protected environments, release storage, synthetic users,
alarm confirmation and recovery drills. Missing setup blocks launch. Runtime config and HTML are
uncached; existing fingerprinted assets remain for sessions and rollback. No HTTP interface, data
schema, invitation policy or production-data migration changes are introduced.
