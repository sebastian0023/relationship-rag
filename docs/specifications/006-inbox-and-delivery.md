# Specification: Inbox and scheduled delivery

## Outcome

A sender explicitly confirms an immutable saved card for immediate or future in-app delivery. The recipient sees exactly one private inbox item at or after its due time and can mark it read.

## Invariants and authorization

- Confirmation includes `confirmed: true`, the saved version, and an idempotency key. Identical retries return the prior acceptance; changed reuse conflicts.
- Approval atomically locks the draft, stores an immutable delivery snapshot, and creates durable dispatch work. Confirmed cards cannot be edited, deleted, canceled, or rescheduled.
- Queue events contain only opaque delivery and couple IDs. Delivery reloads the authoritative snapshot and verifies active recipient membership.
- Inbox creation, delivery completion, and sender status update are transactional. At-least-once processing produces one inbox item.
- Recipients cannot access drafts or scheduled cards. Inbox records are partitioned by recipient identity; inaccessible items return `404`.

## Access patterns and recovery

Delivery and work records use `COUPLE#<coupleId>` with `DELIVERY#<id>` and `DELIVERY_WORK#<nextAttemptAt>#<id>`. Inbox canonical and chronological records use `USER#<recipientId>` with `INBOX_CARD#<cardId>` and `INBOX#<deliveredAt>#<cardId>`. All reads are exact keys or bounded prefix queries.

A one-minute coordinator retries durable work with bounded backoff. Immediate work enters SQS; future work creates a one-time EventBridge schedule with no flexible window and automatic deletion. SQS retries five times before its DLQ. The failure consumer persists safe failure state without downgrading completed work. Maintainer replay retains the original delivery ID.

## Failures and telemetry

Invalid/past schedules are `400`, stale confirmation is `409`, and unavailable dependencies return retryable errors. Metrics cover generation rejection, dispatch backlog, retries, lateness, duplicates, and terminal failures without private content.

Email, cancellation, rescheduling, real-time push, and browser notifications are non-goals.
