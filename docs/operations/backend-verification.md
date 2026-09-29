# Backend verification before the frontend redesign

This inventory tracks the implemented API, asynchronous work, and browser journeys. A feature is
ready only when its local checks, real test-stage check, and cleanup all pass for the same commit and
deployment. Record `PASS`, `FAIL`, `BLOCKED`, or `UNTESTED` for each row. A mocked browser test is
evidence for UI behavior only.
`BLOCKED` in the current-state column means the required real two-profile check has not run; the
listed local checks remain valid evidence for their own layer.

| Area                                                                                               | Specification and acceptance scenarios  | Local evidence                                                               | Real test-stage evidence                                                                           | Current state |
| -------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------- |
| Auth and `/me`                                                                                     | 001, secure-platform-and-authentication | identity domain, application, handler, repository tests; logout browser test | two-profile login and `/me` in `backend.spec.ts`; Phase 7 smoke                                    | BLOCKED       |
| `GET /timeline`; `POST /memories`; `GET/PATCH/DELETE /memories/{id}`                               | 002, story-timeline-and-private-media   | memory service, repository, contract tests                                   | two-profile memory journey and stale version in `backend.spec.ts`                                  | BLOCKED       |
| `POST /memories/{id}/uploads`; `DELETE /memories/{id}/photos/{photoId}`                            | 002, story-timeline-and-private-media   | ten-photo limit and storage adapter tests                                    | PNG upload, processing, private display, removal in `backend.spec.ts`                              | BLOCKED       |
| `GET /memories/{id}/ingestion`; `POST /memories/{id}/reindex`                                      | 003, rag-ingestion-pipeline             | coordinator, normalization, repository tests                                 | indexed status and cleanup in `backend.spec.ts`                                                    | BLOCKED       |
| `GET/POST /conversations`; `GET /conversations/{id}`; `POST /conversations/{id}/messages`          | 004, grounded-chatbot                   | conversation service and retrieval adapter tests                             | cited answer, abstention, creator privacy in `backend.spec.ts`                                     | BLOCKED       |
| `GET /cards/recipients`; `POST /cards/generate`; `GET/POST /cards`; `GET/PATCH/DELETE /cards/{id}` | 005, card-studio                        | card domain, service, repository, malformed-request handler, contract tests  | generation, save, ownership in `backend.spec.ts`                                                   | BLOCKED       |
| `POST /cards/{id}/send`                                                                            | 006, inbox-and-scheduled-delivery       | card service and delivery tests                                              | immediate and scheduled sends in `backend.spec.ts`                                                 | BLOCKED       |
| `GET /inbox`; `GET /inbox/{cardId}`; `PATCH /inbox/{cardId}/read`                                  | 006, inbox-and-scheduled-delivery       | delivery service and malformed-request handler tests                         | recipient read and sender isolation in `backend.spec.ts`                                           | BLOCKED       |
| RAG, media, delivery workers                                                                       | 003, 006, 007 and their feature files   | ingestion and delivery service tests, infrastructure synth tests             | ingestion, media processing, immediate and scheduled delivery in `backend.spec.ts`                 | BLOCKED       |
| Browser flows                                                                                      | 001–007 feature files                   | mocked card/inbox, logout, accessibility Playwright tests                    | two real browser sign-ins and inbox display in `backend.spec.ts`; other actions use real API calls | BLOCKED       |
| Cleanup and privacy                                                                                | 002, 003, 006, 007                      | `npm run test:fixtures`; observability tests                                 | exact test-resource cleanup, artifact audit                                                        | BLOCKED       |

## Checks still required for the readiness gate

- Add direct handler contract coverage for every registered API route and every documented error.
- Add live media tests for JPEG and WebP, plus remaining size, upload-instruction, concurrent upload,
  and storage-removal cases. Local processor tests now cover JPEG, PNG, WebP, corrupt or mislabeled
  bytes, and duplicate events. Product photo/memory deletion still leaves active S3 media objects.
- Add deterministic two-tenant adapter fixtures, cursor tampering, and concurrent write tests.
- Execute retrieval and generation against a versioned synthetic corpus; record recall@5, abstention,
  citation validity, and a manual factual review. The current `rag:chat-eval` and `rag:card-eval`
  commands only validate datasets.
- Exercise failed ingestion, worker retry, DLQ, replay, and dependency failures locally with
  injected dependencies. Label simulated failures as local evidence.
- Run the live browser flow with keyboard navigation and narrow viewport. Check refresh persistence
  and status/error announcements.
- Keep domain/application branch and function coverage above 80% while adding the remaining tests.

## Run order and result record

1. Run `npm run verify`, `npm run test:coverage`, `npm run test:fixtures`,
   `npm run test:backend:integration`, and `npm run test:e2e` with Node 22.22.3.
2. On the existing test deployment, run `npm run test:live:auth`,
   `npm run test:live:preflight`, and `npm run test:live:backend`. Set `PHASE7_BASE_URL`,
   `AWS_ACCOUNT_ID`, and the four `LIVE_OWNER_*` and `LIVE_PARTNER_*` credential variables.
   The run records only resource IDs in `.verification-runs/<runId>.json`.
   `npm run test:live:ai` runs the same full fixture lifecycle, including the 20-case live AI
   evaluation, so it can be invoked as the dedicated AI check.
3. If interrupted, download the manifest and run
   `npm run test:fixtures:cleanup -- <manifest-path>` to review exact targets. Complete pending
   delivery and ingestion first; then rerun with `--confirm`. Never purge a shared queue.
4. Record commit, deployed stack versions, test run ID, each matrix row's result, coverage totals,
   AI scores, cleanup result, defects, and owner. Exclude credentials, content, prompts, signed URLs,
   and raw model output. DynamoDB point-in-time backups retain historical test records for the
   configured 35-day period.

The initial local baseline was 79 passing tests. After the new tests and fixes, full local
verification passed 107 tests, and domain/application coverage reached 93.39% statements,
84.46% branches, 90% functions, and 96.11% lines. Local Playwright passed five tests. The initial
Angular build and Playwright bind failures were sandbox/setup issues; both checks passed under Node
22.22.3 with the required local permissions.
