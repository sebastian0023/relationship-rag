# ADR 0008: Privacy-safe operations and same-region recovery

- Status: Accepted
- Date: 2026-09-21

## Context

The application already enables Lambda active tracing and has a small number of alarms, but handled
HTTP failures and partial SQS batch failures can look successful to Lambda metrics. The current HTTP
API does not support gateway X-Ray segments. Budgets have no subscribers, and recovery has not been
exercised.

## Decision

Keep the lower-cost HTTP API. Correlate its privacy-safe access logs to AWS Distro for OpenTelemetry
traces from API Lambdas with the gateway request ID. Emit bounded Embedded Metric Format records for
handled failures, partial batches, AI usage, and scheduled-worker heartbeats. Publish alarms and
budget notifications through a stage-specific encrypted SNS topic.

Use DynamoDB point-in-time recovery plus S3 versioning for same-region recovery in test and prod.
Restore into isolated resources and require delivery reconciliation before cutover. Bound AI cost and
failure amplification with gateway throttling, reserved concurrency, SDK retry limits, and a shared
request deadline. Budget alerts do not take automatic destructive action.

## Consequences

HTTP API requests do not have a gateway X-Ray segment, so request IDs bridge access logs and Lambda
traces. Same-region recovery does not protect against a regional outage or loss of Cognito users.
Monitoring and retained versions add modest cost, and test-stage operational drills are required to
prove that alarms and restoration work.
