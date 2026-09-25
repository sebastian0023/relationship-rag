# Relationship RAG

Relationship RAG is a private, serverless web application for two invited users. It combines a
visual relationship timeline, grounded question answering over supplied memories, an AI-assisted
card studio, and immediate or scheduled in-app delivery.

The repository implements the private timeline, grounded chat, card studio, and recoverable in-app
delivery described in [`Relationship_RAG_Project_Blueprint.md`](./Relationship_RAG_Project_Blueprint.md).

## Architecture

- Angular standalone web application in `apps/web`
- AWS CDK application and stage-aware stacks in `apps/infrastructure`
- Feature services in `services/*`
- Runtime contracts and shared libraries in `packages/*`
- Specifications, ADRs, API contract, and Gherkin scenarios in `docs` and `features`

The system uses ports and adapters. Domain and application code must not import AWS SDK clients;
AWS-specific behavior belongs in adapters and infrastructure code.

## Prerequisites

- Node.js 22.22.3 or newer (see `.nvmrc`)
- npm 11 or newer
- AWS credentials only for deployment; local build and test do not require them

## Start locally

```bash
npm ci
npm run build
npm test
npm run synth
npm run --workspace @relationship-rag/web start
```

The development server listens on `http://localhost:4200`.

## Quality commands

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run synth
```

Run all gates with `npm run verify`.

## Environments

Stage settings live in `config/stages`. Select a stage for CDK with context:

```bash
npm run synth -- --context stage=dev
```

Production stateful resources are retained and protected from accidental deletion. Development and
test stages are configured for easy cleanup.

## Delivery workflow

Every feature follows specification-driven development, BDD, and TDD in that order. Start from
`docs/specifications`, add acceptance scenarios under `features`, implement domain behavior with
tests, then integrate through adapters and handlers. See [`AGENTS.md`](./AGENTS.md) for repository
working agreements.

## RAG ingestion

Memory content is normalized into a private S3 source document and indexed by Bedrock Knowledge
Bases with S3 Vectors and Titan Text Embeddings V2. New and edited memories become `PENDING`; the
coordinator batches source changes every minute and records `INDEXED` or `FAILED` without logging
private content. Existing memories remain unindexed until an explicit backfill.

Run `APPLICATION_TABLE_NAME=<table> npm run rag:backfill -- --stage test --couple-id <id>` first
to inspect a synthetic-stage backfill. Add `--confirm` only after reviewing the dry run. See
[`docs/operations/phase-3-rollout.md`](./docs/operations/phase-3-rollout.md).

## Security

The application is private by default. Never commit secrets, personal memories, photographs, tokens,
generated user content, or production identifiers. Report vulnerabilities privately to the
maintainer rather than opening a public issue.

## Cards and delivery

Cards are generated only from explicitly selected memories, remain editable until saved, and require
a separate confirmation before delivery. Immediate delivery uses SQS; future delivery uses one-time
EventBridge schedules. Both paths converge on an idempotent worker that creates one recipient inbox
item. See [`docs/operations/phases-5-6-rollout.md`](./docs/operations/phases-5-6-rollout.md) for
monitoring and recovery.

## Operations

Phase 7 adds privacy-safe structured telemetry, correlated API responses, bounded AI execution,
stage budgets with operator notifications, and same-region recovery controls. See
[`docs/operations/phase-7-operations.md`](./docs/operations/phase-7-operations.md) for alarm smoke
tests, restore drills, incident response, and the manual billing-tag prerequisite.

For a test-account bootstrap and protected production launch, follow
[`docs/operations/production-launch.md`](./docs/operations/production-launch.md).
