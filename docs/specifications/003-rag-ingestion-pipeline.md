# Specification: RAG ingestion pipeline

## Outcome

Active members can see whether a shared memory is indexed and retry failed indexing. Memory content is normalized into a private, tenant-filtered source document for later grounded retrieval.

## Invariants

- Only the verified couple identity scopes status, work, documents, and retrieval filters.
- The generated source document contains supplied text metadata only; it excludes photos, URLs, and generated content.
- A memory edit creates a new ingestion generation. Completion from an older generation cannot overwrite it.
- Source updates are synchronized in batches of at most 25. Background workers never log memory text or document contents.
- A failed or stalled ingestion remains observable and retryable. A delete removes its source document on the next batch.

## Access patterns and failures

Canonical status uses `COUPLE#<id>/INGESTION#<memoryId>` and pending work uses `COUPLE#<id>/INGESTION_WORK#<memoryId>`. The coordinator queries this partition prefix; it uses no scans or GSIs.

`GET /memories/{memoryId}/ingestion` and `POST /memories/{memoryId}/reindex` require active membership. A cross-couple or absent memory returns `404`. Retryable failures return safe codes only. Legacy memories remain `NOT_REQUESTED` until explicitly indexed.

## Non-goals

Chat answers, public search, automatic bulk backfill, image understanding, generation quality, and automatic sending are outside this phase.
