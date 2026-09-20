# ADR 0005: Cognito invite-only authentication

- Status: Accepted
- Date: 2026-09-20

## Context

Exactly two invited users may access private memories. Public registration is outside the product
scope.

## Decision

Use an Amazon Cognito User Pool with self-registration disabled, an authorization-code client, and
API Gateway JWT validation. Application authorization scopes every request to the member's couple;
Cognito groups distinguish owner and partner roles.

## Consequences

Accounts are created only through an administrative invitation flow. Authentication alone never
authorizes resource access; handlers pass verified identity to application policies.
