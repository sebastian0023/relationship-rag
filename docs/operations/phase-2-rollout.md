# Phase 2 rollout guide

Deploy only through the existing GitHub OIDC workflow after `npm run verify` passes. Use synthetic images and synthetic text in the test stage; do not upload personal photos for smoke tests.

After deployment, verify one owner and one partner can create a text memory, upload a JPEG under 10 MiB, see it become ready, edit its date, and delete it. Confirm an unauthorized subject receives `403` and a cross-couple ID receives `404`. Check the media processing and cleanup DLQs before promotion.

Roll back application code by redeploying the prior verified revision. Do not delete production buckets or table records. Failed cleanup can be redriven from its DLQ once the fault is resolved.
