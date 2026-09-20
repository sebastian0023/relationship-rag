# ADR 0002: DynamoDB single-table application store

- Status: Accepted
- Date: 2026-09-20

## Context

The workload is small but contains several related entities and must remain serverless and
pay-per-use.

## Decision

Use one on-demand DynamoDB table with explicit repository ports. Partition and sort keys encode
couple, user, conversation, memory, card, and inbox access patterns. Add GSIs only for documented
access patterns; never use scans on application request paths.

## Consequences

Queries remain efficient and infrastructure stays small. Key design requires care, and persistence
models must not leak into domain entities.

## Phase 2 extension

Memories have a canonical item at `COUPLE#<id>/MEMORY_ID#<id>` and a duplicated chronological projection at `COUPLE#<id>/MEMORY#<occurredOn>#<id>`. Transactions create, update, move, and delete both items together. Timeline reads query the projection descending; no GSI or scan is required.
