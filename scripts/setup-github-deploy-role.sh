#!/usr/bin/env bash
set -euo pipefail

stage="${1:-}"
case "$stage" in
  test|prod) ;;
  *) echo 'Usage: scripts/setup-github-deploy-role.sh test|prod' >&2; exit 2 ;;
esac

account_id="$(aws sts get-caller-identity --query Account --output text)"
role_name="relationship-rag-$stage-github-deploy"
provider_arn="arn:aws:iam::$account_id:oidc-provider/token.actions.githubusercontent.com"
role_arn="arn:aws:iam::$account_id:role/$role_name"
policy_name="relationship-rag-$stage-deployment"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cat > "$tmp_dir/trust.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "$provider_arn"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {"StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:sebastian0023/relationship-rag:environment:$stage",
      "token.actions.githubusercontent.com:ref": "refs/heads/main"
    }}
  }]
}
EOF

cat > "$tmp_dir/permissions.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": [
        "arn:aws:iam::$account_id:role/cdk-hnb659fds-deploy-role-$account_id-us-east-1",
        "arn:aws:iam::$account_id:role/cdk-hnb659fds-file-publishing-role-$account_id-us-east-1",
        "arn:aws:iam::$account_id:role/cdk-hnb659fds-image-publishing-role-$account_id-us-east-1",
        "arn:aws:iam::$account_id:role/cdk-hnb659fds-lookup-role-$account_id-us-east-1"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["cloudformation:DescribeStacks", "cloudformation:ListStacks", "ssm:GetParameter"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::relationship-rag-$stage-edge-*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::relationship-rag-$stage-edge-*/*"
    },
    {
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
      "Resource": "arn:aws:cloudfront::$account_id:distribution/*"
    }
  ]
}
EOF

aws iam create-role \
  --role-name "$role_name" \
  --assume-role-policy-document "file://$tmp_dir/trust.json" \
  --tags "Key=Application,Value=relationship-rag" "Key=Environment,Value=$stage" \
  --query Role.Arn --output text
aws iam put-role-policy \
  --role-name "$role_name" \
  --policy-name "$policy_name" \
  --policy-document "file://$tmp_dir/permissions.json"
echo "Configured $role_arn"
