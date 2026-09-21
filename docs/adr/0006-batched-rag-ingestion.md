# ADR 0006: Batched Knowledge Base synchronization

- Status: Accepted
- Date: 2026-09-20

## Context

Memory edits need reliable, private indexing without a Lambda waiting for an asynchronous Bedrock ingestion job.

## Decision

Store authoritative ingestion state and pending work as separate tenant-scoped DynamoDB items. An EventBridge rule sends one message per minute to an SQS-backed coordinator with reserved concurrency one. The coordinator writes at most 25 normalized source changes, starts one incremental Bedrock sync, and reconciles the persisted job on later invocations.

## Consequences

Indexing is eventually consistent and visible as `PENDING`, `INDEXED`, or `FAILED`. Current source documents carry tenant and filter metadata. A generation and content fingerprint prevent a stale job from completing a newer edit. Existing data needs an explicit backfill.
