# ADR 0009: Deploy under the shared account Lambda concurrency limit

- Status: Accepted
- Date: 2026-09-24
- Supersedes: the reserved concurrency settings in ADR 0006 and ADR 0008 while the account limit is 10

## Context

The existing AWS account has a regional Lambda concurrency limit of 10 in `us-east-1`. AWS keeps
at least 10 executions unreserved, so CloudFormation rejects every per-function reserved
concurrency setting at this limit. A quota increase has been requested. The owner authorized
deployment under the current account limit while that request is pending.

## Decision

Stage configuration explicitly disables reserved Lambda concurrency in this account. The
account-wide limit of 10 bounds concurrent execution across this app and other workloads. API
Gateway throttling, SQS retries and dead letters, Bedrock request deadlines, safe telemetry, and
budget alerts remain enabled. Keep the intended per-function reservation values in stage
configuration so they can be restored after AWS raises the quota. Restore reservations only after
the regional limit can accommodate the six app reservations plus 10 unreserved executions.

## Consequences

The app and unrelated Lambda functions share the 10 executions and may throttle each other.
Ingestion and delivery workers can overlap; their conditional writes, idempotency tokens, and
retry paths remain required. Validate delivery and ingestion under this limit before production
promotion, and monitor Lambda throttles. The quota increase alone does not change deployed
function configuration.
