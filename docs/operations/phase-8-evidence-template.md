# Production release evidence

Keep the completed record in restricted operational storage. Do not include private content,
credentials, model output, signed URLs or raw exceptions. A blank or pending entry is not a pass.

## Identity

- Candidate commit and manifest digest:
- Candidate workflow run:
- Production diff review run and assembly digest:
- Reviewer and review timestamp:
- Previous verified rollback candidate:

## Acceptance matrix

| Criterion                                                                | Evidence                                     | Result  |
| ------------------------------------------------------------------------ | -------------------------------------------- | ------- |
| Formatting, lint, types, build and >=80% coverage                        | Candidate job                                | Pending |
| Dependency/secret/IaC security gates                                     | Candidate job and production assertions      | Pending |
| Bundle integrity and promotion fail-closed behavior                      | Release unit tests and manifest verification | Pending |
| Both invited roles, outsider denial and ownership isolation              | identity-isolation                           | Pending |
| Private media, memory lifecycle, ingestion and reindex                   | memories-media                               | Pending |
| Recall@5 >=0.90; indexed foreign decoy excluded                          | retrieval                                    | Pending |
| Abstention >=0.95; critical citations 100%; no forbidden facts           | chat-grounding                               | Pending |
| Draft editing, explicit UI confirmation, scheduled/duplicate delivery    | cards-delivery                               | Pending |
| Keyboard/mobile and serious/critical accessibility violations absent     | accessibility                                | Pending |
| Recorded token/latency metrics and enforced AI limits                    | ai-budgets                                   | Pending |
| Human review of every generated claim against source memories            | Private test UI review                       | Pending |
| Alarm notification received and budget tags active                       | Phase 7 evidence                             | Pending |
| Isolated restore, recovery duration and delivery reconciliation          | Phase 7 evidence                             | Pending |
| Controlled retry/DLQ/replay recovery                                     | Private drill record                         | Pending |
| Private telemetry review                                                 | Operator inspection                          | Pending |
| Previous bundle rollback with records/session/pending delivery preserved | Private rehearsal record                     | Pending |
| Production protection, reviewed diff and explicit deployment approval    | Protected environment review                 | Pending |
| Production read-only smoke and confirmed operator subscription           | Deployment record and operator check         | Pending |
| OWNER and PARTNER first login                                            | Private onboarding outcomes                  | Pending |
| Initial real memories reviewed and indexed                               | Private onboarding outcomes                  | Pending |
| 24-hour observation without unresolved failures                          | Acceptance JSON                              | Pending |
| v1.0.0 tag and sanitized release notes                                   | Finalizer outcome                            | Pending |

## Findings

- Safe failure codes and affected criteria:
- Follow-up owner and resolution:
- Observation start/end (UTC):
- Final maintainer acceptance:
