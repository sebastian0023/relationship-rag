# Phase 8 release and rollback

## Current release status

This runbook and tooling prepare a release; they are not evidence that production is launched.
No phase 7 drill or live acceptance result may be inferred from local tests. Keep the completed
[evidence record](phase-8-evidence-template.md) in restricted operational storage. The repository
and its Actions artifacts may be public. Never upload CDK assemblies, diffs, operator addresses,
production resource identifiers, credentials, signed URLs, private content, or browser traces there.

## One-time setup

1. Confirm the AWS account and Region explicitly. Bootstrap CDK in that account/Region through an
   approved operator session. Verify S3 Vectors, the configured Nova inference profile, Titan
   embeddings, and the ADOT layer are available in that Region. Do not switch models to bypass a
   failed release gate. Model access is finally proven by the live suite.
2. Create a dedicated private release S3 bucket with encryption, all four public-access blocks,
   versioning, TLS-only access, and retention. Keep at least the current and preceding accepted
   bundles plus their manifests/evidence; do not automatically expire the last rollback target.
3. Create GitHub environments `test`, `prod-review`, and `prod`. Set `AWS_ACCOUNT_ID`, `AWS_REGION`,
   `AWS_ROLE_ARN`, and `RELEASE_BUCKET` in each. Store `ALERT_EMAIL` as an environment secret.
4. Restrict environments to protected `main`. Protect main with required CI and reviewed changes to
   workflows/release scripts. In `prod`, configure at least one required maintainer reviewer and
   disable administrator bypass. The production workflow verifies these settings and fails closed
   when the API is inaccessible or protection is absent. Required-reviewer availability depends on
   repository visibility and plan: see [GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
5. Bind each OIDC trust policy to this repository's exact environment subject and audience
   `sts.amazonaws.com`. Use distinct roles: test can manage only test resources; prod-review can
   read production state and write only the private review prefix; prod can deploy only the project
   production stacks and publish its frontend. Candidate storage writes are restricted to test's
   candidate prefix. Only the reviewing operator can write operational attestations. No long-lived
   AWS credentials are needed in GitHub.
6. Confirm the operator's SNS subscription after each initial deployment. Activate `Application`,
   `Environment`, and `CostScope` cost-allocation tags in Billing. Verify budget scope and the
   production USD 50 limit; subscription creation alone is not notification-receipt evidence.

## Bootstrap and synthetic identities

Run **Bootstrap synthetic test stage** from main once after the setup above. It deploys an empty
test stage without pretending that acceptance has passed. It shares the test-stage concurrency lock
with phase 7 and release-candidate validation. Read stack outputs in a private operator session.

Use the existing identity provisioner from the phase 1 runbook for a synthetic OWNER and PARTNER.
Complete first-password setup before adding the following `test` environment secrets:

- `TEST_USERNAME` / `TEST_PASSWORD`: synthetic OWNER.
- `TEST_PARTNER_USERNAME` / `TEST_PARTNER_PASSWORD`: synthetic PARTNER.
- `TEST_OUTSIDER_USERNAME` / `TEST_OUTSIDER_PASSWORD`: a test-only Cognito account with no DynamoDB
  membership. Create it using Cognito admin tooling, complete its password setup, and give it the
  OWNER group so rejection proves membership enforcement. Never create this account in production.

The live suite never mocks authentication or APIs. It seeds a foreign-couple synthetic decoy by an
exact DynamoDB key and private RAG source objects. The operator role needs test-only PutItem,
PutObject, Retrieve, SQS SendMessage, and CloudWatch GetMetricStatistics permissions in addition to
stack-output reads. Test data must remain synthetic. Do not reuse test users for production.

## Candidate and evidence

1. Merge the implementation and phase 7 prerequisites. Run **Release candidate** with an exact
   40-character commit from main. The workflow requires all inputs, deterministic gates, coverage,
   Playwright, dependency audit, Gitleaks, and production approval protection before deployment.
2. The workflow builds the executable assets once, seals them with SHA-256, and deploys test with
   those Lambda assets. The manifest binds all asset files, stage configuration, and versioned
   datasets. Packaging rejects a dirty checkout; verification rejects altered or additional files
   and symlinks. Release archives reject traversal and non-file entries before extraction.
3. The suite polls asynchronous state with bounded deadlines; it never retries a failed scenario or
   model invocation to obtain a better score. It checks real retrieval separately from citations,
   proves the decoy is indexed, and verifies the public API's model responses with contract schemas.
   A failed run remains failed. Fix the cause and create a new reviewed validation run.
4. The candidate and report are stored under
   `candidates/<commit>/<manifest-sha256>/` in private release storage. Only sanitized case outcomes,
   timing, aggregate token/latency metrics, and RAG scores are eligible for GitHub artifact upload.
   Traces, screenshots, videos, response bodies, authentication state and raw errors are disabled.
5. Review generated claims in the test UI against the synthetic source memories. Required/forbidden
   fact matching and citation correctness do not establish support for every claim. Record the
   reviewer's outcome, never the text. Investigate any unsupported claim before signing evidence.
6. Complete phase 7's [alarm/restore runbook](phase-7-operations.md). Confirm the test alarm email
   arrived, perform the isolated restore and delivery reconciliation, and record actual recovery
   points and duration in private storage.
7. Exercise controlled DLQ recovery in the isolated test drill: retain a synthetic pending delivery,
   temporarily make its synthetic recipient inactive, let the original queue message exhaust its
   five receives, and verify the failure archive. Restore that membership, use `delivery:replay`
   dry-run then explicit confirmation with the original delivery ID, and verify exactly one inbox
   item. Re-enable any paused worker only after reconciliation. Never run this against production.
8. Rehearse application rollback using two retained candidates in test. Preserve a memory, an active
   session, a draft, and a pending scheduled delivery; deploy the older sealed Lambda/frontend assets
   with its compatible assembly; verify their continued operation and exactly-once delivery. On the
   first release, first establish a verified test baseline, retain it, then rehearse the next
   candidate against that baseline. Return test to the candidate under review.
9. Complete the strict attestation JSON below and upload it as `attestation.json` beside the candidate
   with the reviewing operator's credentials. All seven checks must actually pass. Evidence expires
   after seven days and must be reviewed again if the candidate or operational state changes.

```json
{
  "version": 1,
  "commit": "<40-character commit>",
  "bundleDigest": "<64-character manifest SHA-256>",
  "reviewedAt": "<UTC ISO timestamp>",
  "reviewer": "<GitHub username>",
  "checks": {
    "alarmNotification": true,
    "restoreDrill": true,
    "deliveryRecovery": true,
    "rollbackRehearsal": true,
    "privateTelemetryReview": true,
    "generatedClaimsReview": true,
    "billingTagsActive": true
  }
}
```

Use a dedicated, clean synthetic fixture set for each candidate. The UI retains generated test
conversations/cards for private review. Record fixture IDs privately and remove only those exact
synthetic fixtures after review; reconcile scheduled deliveries before resetting test. Do not run
repeated candidates over accumulated copies of the same golden memories, which changes retrieval
expectations. Test cleanup never uses a production stage or DynamoDB scans.

## Production promotion and onboarding

Run **Promote production release** from main with the candidate commit and manifest digest. Its
`prod-review` job verifies the immutable bundle, live report and attestation, synthesizes using the
sealed Lambda assets, and saves the production diff and assembly privately under
`reviews/<workflow-run-id>/`. Diff generation uses no change set and does not deploy cloud resources.

Before approving `prod`, retrieve that exact private diff and review resource replacements, IAM,
retention, deletion protection, budget, model settings and runtime origins. Compare the commit,
bundle hash and assembly hash in the workflow summary. Reject unexpected stateful replacements.
The deploy job verifies the approved assembly hash, uses that assembly without re-synthesis, then
publishes the same frontend assets. No data migration occurs.

Publication retains old fingerprinted assets, uploads assets before runtime config and HTML, then
waits for CloudFront invalidation. HTML and runtime config have `no-store`; the cache policy has
minimum TTL zero. Only fingerprinted assets receive immutable caching. See
[CloudFront cache TTL behavior](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_UpdateCachePolicy.html).

Production smoke tests read HTTPS, security/cache headers, validated runtime configuration, and API
rejection of unauthenticated/invalid requests. They perform no user-data writes. A successful
workflow writes a private deployment record; it does not create a release tag or invite users.

After reviewing the successful deployment:

1. Confirm production SNS subscription, budget scope, protected data resources and safe diagnostics.
2. Run the phase 1 provisioner dry-run, review the intended role, then explicitly apply OWNER and
   PARTNER invitations. Keep names/emails in the private operator session. Each user completes their
   own first-password setup and verifies `/me` and the timeline. Do not place their credentials in CI.
3. Users add and review an initial set of real memories using the memory editor. Confirm dates, text,
   photos, and INDEXED status. Review known-answer citations and unknown-question abstention privately.
   Retain only outcomes; do not send private content to release fixtures or CI reports.
4. Any card delivery requires the user's separate confirmation. Do not send an automated launch card.
5. Observe for at least 24 hours. Review dependency failures, latency, ingestion status, DLQs, delivery
   backlog, telemetry privacy, budget notifications and operator reports. Resolve failures before
   acceptance.

## Rollback

Stop onboarding if deployment or smoke checks fail. Preserve all canonical resources and queued work.
For an application regression, select the preceding verified candidate, review compatibility with
current persisted records, and use the same protected promotion workflow with a renewed operational
attestation and its original report. Review the rollback diff before approving. Retained hashed
assets allow existing clients to finish while HTML moves back to the verified frontend. Recheck
sessions, timeline, inbox, existing drafts and pending schedules after deployment. Do not replay
completed deliveries or restore data merely to reverse code.

A first production deployment may have no prior production baseline. In that case suspend onboarding
or disable affected Cognito access through an explicit operator action, keep all resources, repair
and validate a candidate, then resume. Data loss/corruption uses the isolated restore runbook with
separate cutover approval and delivery reconciliation.

## Finalize v1.0.0

Copy the private deployment record from `deployments/<workflow-run-id>.json`. Create a private
acceptance JSON with `version: 1`, its exact `commit`, `bundleDigest`, and `deployedAt`, plus
`observedUntil` and these true outcomes: `ownerOnboarded`, `partnerOnboarded`,
`memoriesReviewedAndIndexed`, `groundingReviewed`, `alertsConfirmed`, `noUnresolvedFailures`.

Set `RELEASE_ACCEPTANCE`, `RELEASE_DEPLOYMENT_RECORD`, `GITHUB_REPOSITORY`, and `RUNNER_TEMP` to the
private local paths/repository and run `npm run release:finalize` for validation. The finalizer rejects
less than 24 hours of observation, future observation times, missing outcomes and deployment mismatch.
Only the maintainer then runs `npm run release:finalize -- --apply` to create v1.0.0 and sanitized
release notes at the exact accepted commit. An existing tag is never overwritten.
