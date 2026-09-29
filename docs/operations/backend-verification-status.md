# Backend verification status

**Readiness for frontend redesign: not yet established.** This report records the local working
tree based on commit `0da057e27dcea852c46958b98df6e0b329012bfa`. The changes in this report
are uncommitted and have not been deployed to AWS.

## Evidence collected

| Check                                                     | Result                                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full local `npm run verify` on Node 22.22.3               | Passed: 107 tests across 25 files, lint, type checks, builds, evaluations, guardrails, and CDK synth                                                    |
| Backend integration selection                             | Passed: 80 tests across 21 files                                                                                                                        |
| Domain/application coverage gate                          | Passed: 93.39% statements, 84.46% branches, 90% functions, 96.11% lines                                                                                 |
| Local Playwright                                          | Passed: 5 browser tests, including mocked card journeys and accessibility                                                                               |
| Fixture lifecycle tests                                   | Passed: 5 tests, including preservation of unrelated records and verification of schedule removal                                                       |
| AWS account and deployment preflight                      | Account `750702272375`; test API stack `UPDATE_COMPLETE`, tagged `test`, last updated 2026-09-26 04:04 UTC                                              |
| Deployed infrastructure controls                          | Passed read-only check: 25 JWT-scoped routes, active encrypted table with point-in-time recovery, and private encrypted/versioned media and RAG buckets |
| Frontend runtime configuration                            | Points to the test API stack endpoint                                                                                                                   |
| Deployed anonymous and malformed-token authorization      | Passed for all 25 API routes; no personal records were accessed                                                                                         |
| Deployed two-member functional journey                    | Not run: two profile credentials are unavailable in this workspace                                                                                      |
| Live retrieval, model, media, scheduled delivery, cleanup | Not run; no synthetic AWS fixtures have been created                                                                                                    |

The local tests found and corrected missing category persistence, invalid request responses that
were returned as server failures, acceptance of mislabeled image bytes, and unsafe pagination
cursors. The OpenAPI memory update schema was corrected. These fixes need deployed verification.
Card and inbox handler tests also verify safe invalid-request responses, inactive memberships, and
role mismatches without accessing feature records.
Fixture cleanup now checks the live test-stage data-stack outputs against the run manifest before
deleting exact resources, then verifies that test schedules are gone. The tests preserve unrelated
records and prove cleanup can be repeated after interruption.

## Remaining gate items

- Configure both profile logins as `LIVE_OWNER_*` and `LIVE_PARTNER_*` test-environment secrets and
  `TEST_BASE_URL` as a test-environment variable. Then run the non-deploying
  `verify-existing-test-stage` workflow against a reviewed commit.
- Review the live run manifest and confirm that all created active records, schedules, and objects
  were removed. Historical DynamoDB backups and noncurrent S3 versions remain under test-stage
  retention.
- Complete the uncovered cases in [the verification inventory](./backend-verification.md),
  including two-tenant isolation fixtures, media deletion and recovery, worker failures, and
  browser keyboard/narrow-screen journeys. Review AI factual claims against the synthetic corpus.
- Memory/photo deletion currently removes database references but does not remove the associated
  active media objects. The test-run cleanup handles its own synthetic objects; the product behavior
  still needs a durable cleanup implementation and verification.
- Record the deployed commit or artifact version alongside the live result; the existing stack
  outputs do not identify its source commit.

The readiness gate remains closed until these checks pass or are resolved with documented evidence.
