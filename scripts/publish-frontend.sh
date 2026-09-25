#!/usr/bin/env bash
set -euo pipefail

stage="${1:-}"
case "$stage" in
  dev|test|prod) ;;
  *) echo 'Usage: scripts/publish-frontend.sh dev|test|prod' >&2; exit 2 ;;
esac

stack_prefix="relationship-rag-$stage"
browser_dir='apps/web/dist/relationship-rag-web/browser'
config_file="$browser_dir/assets/runtime-config.json"

stack_output() {
  aws cloudformation describe-stacks \
    --stack-name "$stack_prefix-$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" \
    --output text
}

require_output() {
  if [[ -z "$1" || "$1" == None ]]; then
    echo "Missing deployment output: $2" >&2
    exit 1
  fi
}

api_origin="$(stack_output api ApiEndpoint)"
authority="$(stack_output auth UserPoolIssuer)"
client_id="$(stack_output auth UserPoolClientId)"
frontend_bucket="$(stack_output edge FrontendBucketName)"
distribution_id="$(stack_output edge DistributionId)"
distribution_domain="$(stack_output edge DistributionDomainName)"
require_output "$api_origin" ApiEndpoint
require_output "$authority" UserPoolIssuer
require_output "$client_id" UserPoolClientId
require_output "$frontend_bucket" FrontendBucketName
require_output "$distribution_id" DistributionId
require_output "$distribution_domain" DistributionDomainName
test -f "$browser_dir/index.html"

API_ORIGIN="$api_origin" AUTHORITY="$authority" CLIENT_ID="$client_id" \
  CONFIG_FILE="$config_file" node --input-type=module -e '
    import { writeFileSync } from "node:fs";
    writeFileSync(process.env.CONFIG_FILE, JSON.stringify({
      apiOrigin: process.env.API_ORIGIN,
      authority: process.env.AUTHORITY,
      clientId: process.env.CLIENT_ID,
      scope: "openid profile email relationship-rag/access",
    }));
  '

aws s3 sync "$browser_dir" "s3://$frontend_bucket" \
  --delete --exclude 'index.html' --exclude 'assets/runtime-config.json' \
  --cache-control 'public, max-age=31536000, immutable'
aws s3 cp "$browser_dir/index.html" "s3://$frontend_bucket/index.html" \
  --content-type 'text/html' --cache-control 'no-cache, no-store, must-revalidate'
aws s3 cp "$config_file" "s3://$frontend_bucket/assets/runtime-config.json" \
  --content-type 'application/json' --cache-control 'no-store'

invalidation_id="$(aws cloudfront create-invalidation \
  --distribution-id "$distribution_id" \
  --paths / /index.html /assets/runtime-config.json \
  --query 'Invalidation.Id' --output text)"
aws cloudfront wait invalidation-completed \
  --distribution-id "$distribution_id" --id "$invalidation_id"

app_url="https://$distribution_domain"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'app_url=%s\n' "$app_url" >> "$GITHUB_OUTPUT"
fi
echo "Published $stage frontend: $app_url"
