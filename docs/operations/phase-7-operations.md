# Phase 7 operations, alarms, and recovery

## Before deployment

Use only synthetic content in the test stage. Run `npm run verify` and inspect the CDK diff. Supply
the operator address at deploy time with `--context alertEmail=<address>` and confirm the resulting
SNS email subscription before accepting the deployment. Activate the `Application`, `Environment`,
and `CostScope` cost-allocation tags in the billing account; tag activation is an account-level
prerequisite that CDK cannot perform.

Use [`phase-7-evidence-template.md`](phase-7-evidence-template.md) for the validation record. The
manual GitHub Actions workflow also uploads its deployed Playwright report and alarm-smoke output as
the `phase7-test-evidence` artifact.

The HTTP API does not emit gateway X-Ray segments. Search its access log by `requestId`, then use the
same `x-correlation-id` in Lambda JSON logs. The API Lambdas load the AWS Distro for OpenTelemetry
Node.js layer and send service and downstream spans through active X-Ray tracing. Do not enable
request/response payload capture.

## Alarm smoke test

Run the dry-run first:

```bash
npm run phase7:alarm-smoke -- --stage test
```

After reviewing the target metric, run it with `--confirm`. Confirm that the
`DeliveryRecordFailureAlarm` changes state and that the subscribed operator receives the
notification. The script refuses stages other than `test`. Record timestamps and receipt in the
Phase 7 evidence report, then allow the synthetic metric to age out.

## Same-region restore drill

Target: complete the drill within four hours. Record `LatestRestorableDateTime`; it defines the
actual recoverable point and expected lost-write interval.

1. Disable the delivery and ingestion EventBridge rules and the delivery queue event-source mapping.
   Do not delete queues, schedules, or source resources.
2. Inventory the test table, media/source bucket versioning, encryption, public-access blocks, tags,
   alarms, IAM grants, and PITR status. Count synthetic memberships, memories, conversations, cards,
   deliveries, and inbox items with exact-key or bounded-prefix queries only.
3. Restore DynamoDB to a new name using `restore-table-to-point-in-time`. Never restore over the
   source table. Restore the newest required noncurrent S3 object versions into isolated prefixes or
   isolated private buckets.
4. Reapply controls that DynamoDB restore does not copy: deletion policy decisions, PITR, tags, IAM
   grants, alarms, and any stream or TTL settings. Verify encryption and S3 public-access blocks.
5. Point an isolated copy of the application at the restored resources. Validate active synthetic
   memberships and the expected timeline, conversations, cards, inbox, delivery records, and media.
6. Rebuild the derived RAG source and Knowledge Base index from restored canonical memories. Run the
   deterministic citation and abstention evaluations.
7. Compare delivery records, inbox records, durable work, SQS messages, DLQ messages, and one-time
   schedules. Remove only synthetic duplicate work after its delivery ID and final state agree.
8. Re-enable dispatch in the isolated environment and verify one immediate and one scheduled
   synthetic card appear exactly once. Keep the original resources until review is complete.

The drill does not restore Cognito passwords or sessions. Recreate test identities through the
invitation/provisioning process if needed. Production cutover and source deletion require separate
maintainer approval.

## Incident response

- For API dependency alarms, locate the request by correlation ID, inspect the safe failure code and
  trace duration, and check DynamoDB/Bedrock service health. Never paste payloads into incident notes.
- For ingestion alarms, stop the schedule if failures amplify, fix the safe failure code, and retry
  bounded work. Rebuild the index from canonical records when consistency is uncertain.
- For delivery backlog or DLQ alarms, keep the queue and records, fix the worker, dry-run
  `npm run delivery:replay`, then replay with the original delivery ID. Verify the inbox before any
  retry.
- For unexpected spend, inspect budget scope, inference-profile usage, invocation counts, token
  metrics, and ingestion volume. Reduce concurrency or disable synthetic test traffic through a
  reviewed deployment; budget alarms never shut the system down.
- Roll back application code while retaining data, queues, schedules, logs, and alarms. Restore data
  only for confirmed corruption or loss.
