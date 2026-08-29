#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_directory/.." && pwd)"
artifact_directory="$repository_root/apps/desktop/dist"
bucket="${FINANCE_OS_UPDATE_BUCKET:?FINANCE_OS_UPDATE_BUCKET is required}"
prefix="${FINANCE_OS_UPDATE_PREFIX:-mac/arm64}"

if [[ ! -f "$artifact_directory/latest-mac.yml" ]]; then
  echo "Missing update manifest: $artifact_directory/latest-mac.yml" >&2
  exit 1
fi

shopt -s nullglob
release_assets=(
  "$artifact_directory"/*.dmg
  "$artifact_directory"/*.dmg.blockmap
  "$artifact_directory"/*.zip
  "$artifact_directory"/*.zip.blockmap
)
if (( ${#release_assets[@]} == 0 )); then
  echo "No desktop release assets found in $artifact_directory" >&2
  exit 1
fi

for asset in "${release_assets[@]}"; do
  uvx --from awscli aws s3 cp "$asset" "s3://$bucket/$prefix/$(basename "$asset")" \
    --only-show-errors
done

# Publish the manifest last so clients never observe an incomplete release.
uvx --from awscli aws s3 cp \
  "$artifact_directory/latest-mac.yml" \
  "s3://$bucket/$prefix/latest-mac.yml" \
  --cache-control "no-cache, no-store, must-revalidate" \
  --content-type "text/yaml" \
  --only-show-errors

echo "Published Chelaro desktop update artifacts to s3://$bucket/$prefix/"
