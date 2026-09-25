# Full application launch

The release target is `us-east-1`, using the existing AWS account for both `test` and `prod`.
Each stage has separate CDK stacks and data resources. Use the CloudFront HTTPS domain emitted by
each Edge stack. Local `ng serve` has no working Cognito callback; verify sign-in through the
deployed domain.

## One-time account and GitHub setup

1. Use the existing AWS account, enable billing access, and set account-level spend notifications.
   Record its ID in both GitHub environments as `AWS_ACCOUNT_ID`. Use an operator identity with MFA
   for bootstrap and invitation tasks.
2. In the account, check `us-east-1` availability, access, and quotas for Amazon Nova Micro,
   Titan Text Embeddings V2, Bedrock Knowledge Bases, S3 Vectors, Lambda, and CloudFront. Resolve
   any access or quota issue before deploying. Bootstrap the account/region with
   `npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1` from an approved operator session.
   This shared account currently has a Lambda concurrency limit of 10. The stage configs set
   `reserveLambdaConcurrency=false` so deployments use that account-wide cap while the quota
   increase request is pending. Review Lambda throttles during validation and restore per-function
   reservations only after the limit supports them plus 10 unreserved executions (ADR 0009).
3. Reuse the existing GitHub OIDC provider `token.actions.githubusercontent.com`, with audience
   `sts.amazonaws.com`. Create separate test and production deployment roles. Restrict their
   trust to this repository's `test` or `prod` environment, respectively, and to `refs/heads/main`.
   This repository uses GitHub's immutable OIDC subject format, so the setup script includes its
   owner and repository IDs in each trust condition.
   After reviewing its trust and permissions, run `bash scripts/setup-github-deploy-role.sh test`
   and later `bash scripts/setup-github-deploy-role.sh prod` from the authorized AWS session. The
   script grants the CDK bootstrap deployment/asset permissions and the CloudFormation output,
   frontend S3 publication, and CloudFront invalidation permissions used by the workflows. Review
   the resulting CDK execution role permissions before granting deployment access. The default
   bootstrap execution role uses `AdministratorAccess`; this gives a compromised deployment
   workflow broad control of the shared AWS account. Protect workflow changes and the `prod`
   environment accordingly.
4. Create GitHub environments `test` and `prod`, each limited to `main`. Set environment variables
   `AWS_ACCOUNT_ID`, `AWS_ROLE_ARN`, `AWS_REGION=us-east-1`, and `ALERT_EMAIL`. Require an independent
   reviewer for `prod`. Set `TEST_USERNAME` and `TEST_PASSWORD` as **test environment secrets** only
   after creating a synthetic test member and completing its first-password flow. Never store
   production credentials or member email addresses in repository files or workflow variables.
5. Activate `Application`, `Environment`, and `CostScope` cost allocation tags in the billing
   account. Confirm the SNS alert subscription for each stage after deployment. The CDK budgets
   alert at the configured thresholds; they do not stop charges.

The role trust conditions limit each workflow to its stage. Verify the resolved account with
`aws sts get-caller-identity` before bootstrap, member provisioning, and every manual operation.
The workflows also stop when the assumed account differs from `AWS_ACCOUNT_ID`.

## Test bootstrap and validation

1. Run `npm run verify`, `npm run test:e2e -- --project=chromium`, and a `cdk diff` for `test` from
   an authorized test-account session. Review the changes and expected costs. Run **Bootstrap test
   deployment** from `main`. It deploys all seven stacks and publishes the frontend without
   requiring test login credentials.
2. Get `ApplicationTableName` from the test Data stack and `UserPoolId` from the test Auth stack.
   Provision one synthetic `OWNER` and one synthetic `PARTNER` with the identity workspace command:

   ```bash
   APPLICATION_TABLE_NAME=<test-table> COUPLE_ID=relationship-rag-test USER_POOL_ID=<test-pool> \
     npm run --workspace @relationship-rag/identity provision -- \
     --email <synthetic-email> --display-name <synthetic-name> --role OWNER
   ```

   Review the role-only dry run, then repeat with `--apply`; do the same for `PARTNER`. Complete
   the first-password login, then save one synthetic member's credentials as the test environment
   secrets. Keep synthetic content and credentials out of evidence artifacts.

3. Run **Phase 7 test-stage validation** on `main`. Record its successful run ID, commit SHA,
   Playwright artifact, alarm notification receipt, and CDK events. The production workflow will
   reject a test run from another commit or a failed run.
4. With both synthetic members, verify: text/photo creation, edit, delete, and indexing; a cited
   answer and an unknown-answer abstention; card generation from selected memories, editing, and
   canceled send; immediate and scheduled send after explicit confirmation; recipient inbox and
   read state; unauthorized `403` and cross-couple `404`. Check all relevant DLQs, alarms, and safe
   logs. Complete the same-region restore drill and record the result using the Phase 7 evidence
   template. Do not promote until the complete journey passes.

## Production release

1. Confirm the test evidence and compare the production CDK diff against the intended seven-stack
   change. Confirm retention, deletion protection, DynamoDB PITR, S3 versioning, queues, DLQs,
   budget, and alert recipient. The protected GitHub environment reviewer approves only that exact
   commit and test run ID.
2. Run **Deploy production** from `main` with the successful test validation run ID. The workflow
   checks the commit and account, runs `npm run verify`, deploys all stacks, publishes uncached
   runtime configuration, waits for CloudFront invalidation, and checks the site response. Record
   the CloudFront URL from its job summary and the Edge stack output.
3. From an approved production operator session, dry-run and then apply the identity provision
   command for exactly one real `OWNER` and one real `PARTNER`, using the production table, pool,
   and `COUPLE_ID=relationship-rag-prod`. The operator supplies their email addresses directly;
   do not put them in CI. Confirm both invitations and first sign-ins, `/me`, and that an uninvited
   Cognito subject receives `403`.
4. With the users' approval, perform one small production journey across timeline, cited chat,
   card edit, explicit send, and recipient inbox. Verify alarms and DLQs remain healthy, then share
   the CloudFront URL with the two users.

If validation fails, redeploy the previous verified revision after checking compatibility with
pending delivery work. Retain production data, queues, schedules, and logs. Use the delivery replay
runbook for a failed item and the restore runbook only for confirmed data loss or corruption. Do not
delete production resources as a rollback step.
