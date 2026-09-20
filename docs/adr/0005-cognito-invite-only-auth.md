# ADR 0005: Cognito invite-only authentication

- Status: Accepted
- Date: 2026-09-20

## Context

Exactly two invited users may access private memories. Public registration is outside the product
scope.

## Decision

Use an Amazon Cognito User Pool with self-registration disabled, a secretless authorization-code
client with PKCE, Cognito managed login, and API Gateway JWT validation. The API requires the
`relationship-rag/access` resource-server scope. Application authorization scopes every request to
the configured couple; Cognito groups distinguish owner and partner roles, while active DynamoDB
membership records remain the source of authorization.

## Consequences

Accounts are created only through an idempotent administrative provisioning command. Authentication
alone never authorizes resource access; handlers pass verified identity to application policies.
The web client retains tokens only in session storage and clears them before Cognito logout.
