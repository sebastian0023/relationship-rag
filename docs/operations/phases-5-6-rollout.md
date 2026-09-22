# Phases 5–6 rollout and recovery

Run `npm run verify` and the card Playwright journey before deployment. Deploy first to `test` with synthetic English and Spanish memories and two active synthetic members. Verify generic and memory-based generation, rejected regeneration, draft concurrency, canceled confirmation, immediate delivery, scheduled delivery, unread/read state, and cross-member `404` responses.

Monitor generation errors and output rejection, `DELIVERY_WORK` age, coordinator errors, delivery Lambda errors and duration, queue age, DLQ depth, delivery lateness, duplicate completions, and terminal failures. Logs must contain only opaque IDs and safe diagnostics.

For a terminal failure, inspect the delivery ID and safe failure code. Dry-run a replay:

```bash
APPLICATION_TABLE_NAME=<table> DELIVERY_QUEUE_URL=<queue> npm run delivery:replay -- --couple-id <couple> --delivery-id <delivery>
```

After confirming the delivery is not complete, repeat with `--confirm`. Replay uses the original delivery ID, so a concurrent or repeated replay cannot create another inbox item.

During rollback, keep the messaging stack and compatible workers deployed until all accepted work has delivered or reached a durable failure state. UI and API functions can return to the previous release without deleting delivery, card, or inbox records.
