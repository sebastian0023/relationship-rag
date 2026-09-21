# Specification: Grounded chatbot

## Outcome

An active member can keep private conversations about their shared memories. Every asserted answer cites current, indexed memories; questions without sufficient evidence receive an explicit abstention.

## Invariants

- Conversations, messages, request identifiers, and cursors are scoped to the authenticated couple and creating user. A missing or another user's conversation returns `404` with no metadata.
- The model receives only the current question, bounded completed conversation context, and verified canonical memory text. Photos and raw retrieval chunks are excluded.
- A non-abstaining answer has one or more citations constructed from server-verified evidence. Unknown, malformed, truncated, or uncited model output is never returned as an answer.
- Request IDs are idempotent. Replaying a completed request returns its stored turn; reusing it for a different question conflicts.
- Logs and metrics contain only opaque IDs, counts, latency, token counts, and safe diagnostic codes. They contain no questions, answers, prompts, memory text, or photographs.

## Access patterns and failures

Conversation records use `COUPLE#<coupleId>#USER#<userId>` partitions with canonical conversation keys, creation-order projections, ordered turn keys, and request-ID keys. Reads query a user partition or use exact keys; no scans or GSIs are used.

`POST /conversations`, `GET /conversations`, `GET /conversations/{id}`, and `POST /conversations/{id}/messages` require active membership. Requests validate UUIDs, text limits, cursors, and inclusive date filters. Invalid input returns `400`; inactive membership returns `403`; missing or inaccessible conversations return `404`; duplicate in-flight work returns `409`; model/retrieval failures return safe retryable dependency errors.

## Non-goals

Streaming, shared conversations, conversation deletion, external knowledge, media understanding, automatic memory backfill, and card generation or delivery are outside this phase.
