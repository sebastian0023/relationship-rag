# Specification: Card studio

## Outcome

An active member can generate an English or Spanish card from explicitly selected memories, edit it, and save or delete a private draft. Generation never persists or sends content.

## Invariants and authorization

- The sender and recipient are distinct active members of the authenticated couple. Missing or cross-couple cards, recipients, and memories return `404` without metadata.
- Only selected canonical memories are sent to the model. An empty selection produces a generic card without relationship facts or citations.
- Model output is schema validated. Memory-based output cites at least one selected memory; unknown citations and unsupported output are rejected.
- Only `DRAFT` cards can be edited or deleted. Updates use optimistic versions, and save request IDs are idempotent.
- Logs contain opaque IDs, status codes, counts, latency, and safe failure codes. They never contain card text, memories, prompts, or tokens.

## Contract and access patterns

`GET /cards/recipients`, `POST /cards/generate`, `POST /cards`, `GET /cards`, `GET|PATCH|DELETE /cards/{cardId}`, and `POST /cards/{cardId}/send` use schemas from `packages/contracts`.

Cards use a sender partition, `COUPLE#<coupleId>#USER#<senderId>`, with canonical `CARD#<id>`, chronological `CARD_CREATED#<createdAt>#<id>`, and idempotency records. Reads use exact keys or bounded prefix queries without scans or GSIs.

## Failures and non-goals

Invalid input is `400`, inactive membership is `403`, inaccessible resources are `404`, stale or immutable state is `409`, and model failures are retryable dependency errors. Automatic memory retrieval, image generation, rich-text/HTML cards, external sharing, and email are outside this phase.
