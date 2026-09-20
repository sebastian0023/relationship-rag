# Specification: story timeline and private media

## Outcome

Either active member can create, update, view, and delete shared memories. Memories are shown newest-first and can have up to ten private JPEG, PNG, or WebP photographs.

## Invariants

- Couple identity and creator identity come from the verified JWT membership, never request data.
- Both active roles can manage shared memories. A memory outside the active couple returns `404` with no metadata.
- Canonical and chronological DynamoDB records are written together. Updates require the current version and return `409` when stale.
- Uploaded bytes enter a private staging prefix only through a five-minute, exact-key presigned POST. The policy fixes the MIME type and size, and no staging object is ever rendered.
- The API accepts at most ten photos per memory, each at most 10 MiB. Private display URLs expire after five minutes and are never stored in browser storage.
- Logs contain only opaque IDs, result codes, and latency; they exclude memory bodies, filenames, media keys, signed URLs, and tokens.

## Access patterns and failures

`GET /timeline` queries `COUPLE#<id>` by `MEMORY#` in descending order, with a signed opaque continuation key. Canonical reads use `MEMORY_ID#<id>`. There are no scans or indexes.

Bad input returns `400`, stale writes or exhausted photo capacity return `409`, unauthorized tenancy is `404`, and active-membership failures are `403`. Deletion hides records in one transaction; storage cleanup is asynchronous and retryable.

## Non-goals

RAG indexing, video, HEIC, photo reordering, public sharing, search, PWA support, and model generation are out of scope.
