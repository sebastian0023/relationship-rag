# ADR 0004: Amazon Nova Micro as default generator

- Status: Accepted
- Date: 2026-09-20

## Context

The application needs grounded bilingual text generation with low latency and cost for personal use.

## Decision

Use Amazon Nova Micro by default. Promote individual use cases to Nova Lite only when versioned
evaluation results demonstrate that Micro misses an agreed quality threshold.

## Consequences

Model output is always treated as untrusted and schema validated. Model selection remains behind an
application port, and quality/cost changes require evaluation evidence.
