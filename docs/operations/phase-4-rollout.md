# Phase 4 rollout guide

Deploy only after `npm run verify` and deterministic chat evaluation pass. Start in the test stage with synthetic English and Spanish memories. Verify a known answer cites its timeline memory, an unknown question abstains, follow-ups use the preceding turn, filters narrow retrieval, and one member receives `404` for another member's conversation.

Monitor chat latency, dependency failures, model-output rejections, evidence counts, and abstention rate. Logs must contain only opaque identifiers and safe diagnostics. Roll back to the prior application version if grounding or latency gates regress; retain persisted conversation records.
