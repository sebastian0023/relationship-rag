# AGENTS.md

## Purpose

This repository implements the architecture in `Relationship_RAG_Project_Blueprint.md`. Work in
small vertical slices and preserve privacy, tenant isolation, grounding, and explicit user approval
as first-class product invariants.

## Repository map

- `apps/web`: Angular UI; standalone components, Signals, RxJS, and Tailwind CSS.
- `apps/infrastructure`: stage-aware AWS CDK stacks.
- `services/<feature>`: feature-owned domain, application, adapters, and handlers.
- `packages/contracts`: Zod schemas and shared API types; the source of truth for HTTP contracts.
- `packages/domain`: dependency-free shared domain primitives.
- `packages/observability`: safe structured logging and telemetry helpers.
- `packages/test-utils`: deterministic builders and fakes.
- `docs/specifications`: feature specifications and non-goals.
- `features`: executable-style Gherkin acceptance scenarios.
- `docs/adr`: architecture decisions; add or supersede records when architecture changes.

## Required workflow

For every vertical feature:

1. Specify the user outcome, non-goals, invariants, contract, access patterns, authorization,
   failures, and telemetry in `docs/specifications`.
2. Write Given/When/Then scenarios in `features` before implementation.
3. Implement with red/green/refactor tests at domain and application boundaries.
4. Add contract, infrastructure, integration, and Playwright coverage where applicable.
5. For RAG changes, update the versioned evaluation dataset and enforce citation and abstention
   behavior.

## Architectural constraints

- Domain and application modules must not import AWS SDK or Angular packages.
- Handlers only translate transport events and invoke application use cases.
- Validate every external input and model output with schemas from `packages/contracts`.
- Scope every data access by authenticated couple/user identity. Cross-couple lookups return 404 and
  disclose no metadata.
- Do not use DynamoDB scans in application paths. Document each new access pattern before adding a
  GSI.
- Generated answers and cards may transform supplied memories but must not invent relationship facts.
- Chat responses expose supporting memory IDs and abstain when evidence is insufficient.
- AI generation never sends a card. Sending always requires a separate explicit user action.
- Async delivery must be idempotent, retryable, observable, and recoverable through a DLQ.
- Never log tokens, raw private memories, card bodies, photographs, or model prompts containing user
  data. Log opaque IDs and safe diagnostics only.
- Production data resources use retention and deletion protection; ephemeral stages may self-delete.

## Commands

- Install: `npm ci`
- Full verification: `npm run verify`
- Format: `npm run format`
- Lint: `npm run lint`
- Type check: `npm run typecheck`
- Unit tests: `npm test`
- Coverage: `npm run test:coverage`
- Build: `npm run build`
- CDK synth: `npm run synth -- --context stage=dev`
- Web dev server: `npm run --workspace @relationship-rag/web start`

## Change discipline

- Keep commits narrowly scoped; do not mix refactors with feature behavior unless necessary.
- Update tests, OpenAPI, Gherkin, ADRs, and documentation in the same change as affected behavior.
- Prefer repository interfaces and injected ports over globally mocked SDK clients.
- Treat coverage as a signal. New domain/application branches should be meaningfully tested, with an
  80% minimum target.
- Do not deploy, modify cloud resources, import real user content, or weaken security controls without
  explicit maintainer direction.
- Do not commit generated directories (`dist`, `coverage`, `.angular`, `cdk.out`) or secrets.

## Definition of done

A feature is done only when its specification and acceptance scenarios exist, deterministic tests
pass, contracts and authorization are verified, applicable integration/E2E/RAG evaluations pass,
failure handling and observability exist, and documentation remains current.
