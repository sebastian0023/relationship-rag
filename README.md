# Relationship RAG

Relationship RAG is a private, serverless web application for two invited users. It combines a
visual relationship timeline, grounded question answering over supplied memories, an AI-assisted
card studio, and immediate or scheduled in-app delivery.

The repository currently implements the Phase 0 foundation described in
[`Relationship_RAG_Project_Blueprint.md`](./Relationship_RAG_Project_Blueprint.md). Product features
are intentionally introduced as tested vertical slices, beginning with authentication and a
text-only memory timeline.

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

## Security

The application is private by default. Never commit secrets, personal memories, photographs, tokens,
generated user content, or production identifiers. Report vulnerabilities privately to the
maintainer rather than opening a public issue.
