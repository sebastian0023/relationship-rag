# Phase 1 rollout guide

## Prerequisites

Deploy only from the existing GitHub OIDC workflow with an AWS role that can manage the CDK stacks,
upload the generated frontend to the Edge bucket, and invalidate the CloudFront distribution. Do not
place user credentials, Cognito tokens, or invitation emails in repository files or GitHub variables.

## Initial deployment

1. Configure `AWS_ROLE_ARN` and `AWS_REGION` in the `dev` GitHub environment, then run the deploy workflow.
2. The workflow deploys the stage stacks, writes `runtime-config.json` from stack outputs, uploads the Angular browser bundle, and invalidates CloudFront entrypoints.
3. Provision one account at a time from an approved operator environment. Run the identity workspace command without `--apply` first, then repeat it with `--apply` after reviewing the role only:

   ```bash
   APPLICATION_TABLE_NAME=... COUPLE_ID=relationship-rag-dev USER_POOL_ID=... \
     npm run --workspace @relationship-rag/identity provision -- \
     --email invited@example.test --display-name "Invited member" --role OWNER --apply
   ```

4. Repeat for the `PARTNER` role. The command refuses a replacement or third member. A retry after a partial run is safe for the same email and role.
   To resend an existing member's temporary-password invitation, add
   `--resend-invitation --apply`; the action is always explicit.

## Verification and rollback

- Verify the managed-login domain has no sign-up link, complete first-password setup for both invited identities, call `/me`, and confirm a third Cognito account receives `403`.
- Verify a missing, expired, or ID token is rejected by API Gateway, and that CloudFront routes `/app` to the SPA without exposing the S3 bucket.
- Roll back application code by redeploying the prior verified revision. To disable access immediately, remove the affected active membership or disable the Cognito user through the AWS console; do not delete production data resources.
