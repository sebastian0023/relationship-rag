# ADR 0003: Bedrock Knowledge Bases with S3 Vectors

- Status: Accepted
- Date: 2026-09-20

## Context

Chat and card generation need semantic retrieval with strict tenant metadata filters, low operations
overhead, and AWS-native security.

## Decision

Use Amazon Bedrock Knowledge Bases, an encrypted S3 source bucket, S3 Vectors, and Titan Text
Embeddings V2. Source documents carry couple, date, category, tag, and memory metadata.

## Consequences

AWS manages ingestion and retrieval plumbing. The application still owns relevance thresholds,
isolation tests, citation validation, abstention, evaluation datasets, and re-index failure handling.
