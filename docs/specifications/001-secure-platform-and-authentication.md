# Specification: secure platform and authentication

## Outcome

The two invited members of one couple can sign in through Cognito managed login, reach the protected web shell, and retrieve their profile from `GET /me`.

## Non-goals

- Public registration, invitation UI, custom credential forms, MFA enrollment, and any relationship content feature.
- Deploying resources or sending a real invitation during this change.

## Invariants

- An authenticated Cognito account is not an authorized member until a matching active membership exists in the configured couple.
- The authenticated subject and Cognito groups come only from API Gateway JWT claims. Request input cannot select a user, role, or couple.
- A couple contains one `OWNER` and one `PARTNER`; reserved memberships never authorize access.
- Membership reads use `COUPLE#<configured couple ID>` and `MEMBER#<subject>` with consistent reads. There are no scans or new indexes.
- Tokens, authorization codes, emails, display names, and request bodies are never logged.

## Contract and failures

`GET /me` requires the `relationship-rag/access` OAuth scope. It returns `200` and the shared `MemberProfile` schema for an active member with exactly one matching role group. API Gateway rejects a missing, invalid, expired, wrong-audience, or wrong-scope token. The handler returns a generic `403` for a missing, inactive, or inconsistent membership and `500` with a correlation ID for repository failures.

## Access pattern and telemetry

The profile handler makes one strongly consistent `GetItem` through its repository. It logs only event name, opaque request ID, opaque subject ID, result code, and latency. Provisioning uses conditional profile and membership writes so retries are safe and a third account or role replacement is rejected.
