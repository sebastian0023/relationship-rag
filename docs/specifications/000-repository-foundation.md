# Specification: repository foundation

## Outcome

A contributor can clone the repository, install once, and run formatting, linting, type checking,
unit tests, application builds, and CDK synthesis without cloud credentials.

## Non-goals

- Deploying AWS resources.
- Implementing end-user authentication, memory persistence, RAG, card generation, or delivery.
- Storing any real relationship data.

## Invariants

- Domain and application code remain independent of frameworks and AWS SDK clients.
- Contracts are runtime validated and shared by clients and handlers.
- Every infrastructure resource is stage-named and has environment-appropriate retention behavior.
- CI uses GitHub OIDC for deployments and never stores long-lived AWS access keys.

## Acceptance criteria

- `npm ci` succeeds from a clean checkout.
- `npm run verify` passes without AWS credentials.
- `dev`, `test`, and `prod` configurations are present and schema validated.
- All planned CDK stacks synthesize for the default `dev` stage.
- Repository guidance, architecture records, OpenAPI skeleton, and initial Gherkin feature exist.
