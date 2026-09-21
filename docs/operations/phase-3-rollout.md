# Phase 3 rollout guide

Deploy through the existing OIDC workflow after `npm run verify` succeeds. Deploy to the test stage first and create only synthetic English and Spanish memories.

Confirm a new memory becomes `PENDING` and then `INDEXED`, an edit queues another generation, a delete removes the source document after its batch, and a second couple never retrieves test data. Check the ingestion DLQ, pending-age alarm, failure alarm, and stalled-job alarm before promotion.

Existing memories are not indexed automatically. First run `npm run rag:backfill -- --stage test --couple-id <id>` to inspect the count. After reviewing the dry-run output, rerun with `--confirm`; the command stores a checkpoint and is safe to resume. Do not use it against personal production content without maintainer approval.

To roll back, disable the ingestion schedule and redeploy the prior verified code. Do not delete the production source bucket, vector index, or DynamoDB records. Redrive failed queue messages only after fixing the reported safe failure code.
