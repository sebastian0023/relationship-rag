# ADR 0007: Durable, idempotent card delivery

- Status: Accepted
- Date: 2026-09-21

## Context

API acceptance, schedule creation, SQS delivery, and Lambda execution can fail independently or repeat. An approved private card must not be lost or delivered twice.

## Decision

Approval uses one DynamoDB transaction to lock the card version, persist an immutable delivery snapshot, save the idempotency response, and create durable dispatch work. A coordinator dispatches work to SQS or a one-time EventBridge schedule. The delivery worker transactionally creates canonical and chronological inbox records and marks the delivery and sender card complete. Deterministic schedule and delivery IDs make uncertain retries safe.

SQS uses partial batch responses, five receives, and a DLQ. A DLQ consumer records terminal failure without changing a completed delivery. Maintainer replay reuses the original delivery ID.

## Consequences

Delivery is at least once internally and exactly once in visible application state. Scheduled delivery has EventBridge Scheduler's minute-level precision. Persistent work and duplicated projections add storage but avoid scans and support recovery.
