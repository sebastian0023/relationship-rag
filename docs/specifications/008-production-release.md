# Specification: Production release

## Outcome and non-goals

Two invited users can use a verified production release on the CloudFront HTTPS domain, enter
their first memories through the UI, and recover from an application regression. Custom domains,
bulk import, new product behavior, schema migrations, and automated production writes are excluded.

## Invariants and authorization

- A candidate is an exact commit reachable from main. Test and production use the same checksummed
  executable assets; stage-specific assemblies and runtime configuration are generated separately.
- Mandatory checks cannot be skipped or retried to conceal a failure. Failed or incomplete evidence
  blocks promotion. Phase 7 alarm receipt and isolated restore evidence are required.
- Production deployment requires a protected GitHub environment with required reviewers and no
  administrator bypass. Approval binds the candidate, checksums, production diff, and evidence.
- Only synthetic fixtures enter test. Production invitations, real-content entry, and sending are
  explicit operator/user actions. Automated production smoke checks are read-only.
- Rollback preserves data, identities, queues, schedules, and audit history. No automatic data restore.
- Reports contain case IDs, statuses, counts, durations, hashes, and safe reason codes only. No
  tokens, credentials, signed URLs, raw exceptions, prompts, model output, or private content.

## Contracts and access patterns

Release manifests and operational attestations are strict versioned schemas in packages/contracts.
They bind evidence to a commit and bundle digest. No HTTP contracts, DynamoDB access patterns, GSIs,
or public runtime configuration fields change. Operator tooling uses stack outputs and exact-key
queries. Test-only foreign-couple fixtures use a separate synthetic partition and source prefix.

## Release gates

Formatting, lint, types, deterministic tests, 80% coverage, local and deployed acceptance, dependency
audit, secret scan, production infrastructure assertions, and live RAG evaluation must pass.
Recall@5 >= 0.90; abstention >= 0.95; critical citation correctness and schema validity are 100%;
cross-couple leakage and forbidden facts are zero. A reviewer verifies factual support of generated
claims; citations alone are insufficient. Existing AI deadlines and output limits remain enforced.
Alarm receipt, restore, delivery failure recovery, rollback rehearsal, and private telemetry review
are explicit evidence requirements, never inferred from passing unit tests.

## Failure handling, telemetry, and completion

Incomplete prerequisites fail closed before cloud writes. Publish assets before runtime config and
HTML, retain previous hashed assets, and wait for invalidation. Failed production smoke halts
onboarding; an operator redeploys the prior verified release. On the first launch, suspend access
and repair while retaining resources. Only mark v1.0.0 accepted after both invitations, reviewed
indexed memories, active alerts, and 24 hours of observation. Release records preserve candidate
identity and pass/fail evidence; environment identifiers remain in restricted operational storage.
