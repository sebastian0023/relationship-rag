# Specification: Hardening, observability, and cost controls

## Outcome

Maintainers can detect and diagnose failures without exposing private relationship data, restore
critical records after accidental loss, and receive warning before expected monthly spend is
exceeded. The complete web experience remains usable by keyboard and on small screens.

## Non-goals

Production launch, real-user data import, cross-Region disaster recovery, automatic budget
shutdown, per-user paid quotas, and a migration from API Gateway HTTP APIs are outside this phase.

## Invariants

- Telemetry contains only fixed event names, opaque identifiers, counts, durations, status codes,
  and enumerated failure reasons. It never contains tokens, request bodies, memories, card text,
  photographs, prompts, model output, signed URLs, or raw exception messages.
- Metric dimensions are bounded to stage, service, and operation. User, couple, memory, card, and
  delivery identifiers are never metric dimensions.
- Every application response exposes the gateway request ID as `x-correlation-id`. Asynchronous
  work is correlated with opaque work and message identifiers.
- Every inaccessible cross-tenant resource returns `404` without resource metadata.
- AI work has bounded inputs, outputs, retries, concurrency, and a deadline shorter than the Lambda
  timeout. Timeouts persist a safe retryable failure where the workflow has durable state.
- Budget notifications inform operators and never disable the application automatically.
- Restores create isolated resources. Delivery remains disabled until restored delivery and
  schedule state has been reconciled.

## Telemetry and alerts

HTTP access logs include request ID, route, response status, integration status, and latency. Lambda
logs use the shared safe JSON logger and Embedded Metric Format records. The API Lambdas use the
AWS Distro for OpenTelemetry Node.js layer with active X-Ray tracing to send service and downstream
segments. The HTTP API is correlated through its access log because HTTP APIs do not provide gateway
X-Ray segments.

Alarms cover API 5xx/429 responses, Lambda errors/throttles/duration, handled dependency failures,
media and ingestion failures, durable delivery backlog, and every DLQ. Alarm actions publish to a
stage-specific encrypted SNS topic. Missing traffic does not alarm; a missing scheduled-worker
heartbeat does.

## Cost and capacity controls

Monthly budgets remain USD 15 for dev, USD 20 for test, and USD 50 for prod. Actual spend alerts at
80% and 100%; forecast spend alerts at 100%. A stage-specific cost-allocation tag scopes the budget, and
tagged Bedrock application inference profiles attribute chat and card generation.

API default throttling is 10 requests/second with burst 20. Chat and card Lambdas each reserve two
concurrent executions. Bedrock operations use at most two SDK attempts and share a 24-second request
deadline. Token counts and model latency are recorded without content.

## Recovery

DynamoDB point-in-time recovery and private-bucket versioning are enabled in test and prod. DynamoDB
keeps 35 days of recovery points; S3 noncurrent versions expire after 35 days. A restore targets four
hours, restores into isolated resources, reapplies controls omitted by DynamoDB restore, validates
canonical data, rebuilds the derived RAG index, and reconciles delivery before cutover.

## Accessibility and responsive behavior

Login, shell navigation, timeline, memory forms, chat, card confirmation, and inbox meet WCAG 2.2 AA
for labels, focus visibility, keyboard use, status announcements, contrast, reduced motion, zoom,
and widths down to 320 pixels. Explicit delivery confirmation remains required and cannot be
submitted twice while busy.

## Failures and telemetry

Gateway throttles return `429`. Application dependency failures remain retryable `503` responses.
Operators use the response correlation ID to find safe logs and traces. Failure metrics are emitted
for handled errors and partial batch failures so a successful Lambda invocation cannot hide a user
or record-level failure.
