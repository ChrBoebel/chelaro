#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

requested_tag="${1:-}"
root_version="$(node -p "require('./package.json').version")"
desktop_version="$(node -p "require('./apps/desktop/package.json').version")"
web_version="$(node -p "require('./apps/web/package.json').version")"

if [[ "$root_version" != "$desktop_version" || "$root_version" != "$web_version" ]]; then
  echo "Product versions must match (root=$root_version desktop=$desktop_version web=$web_version)." >&2
  exit 1
fi

expected_tag="v$desktop_version"
if [[ -n "$requested_tag" && "$requested_tag" != "$expected_tag" ]]; then
  echo "Release tag $requested_tag does not match package version $expected_tag." >&2
  exit 1
fi

for required_file in \
  CHANGELOG.md \
  SECURITY.md \
  docs/releases/RELEASE_PROCESS.md \
  "docs/releases/$expected_tag.md" \
  apps/desktop/assets/icon.icns \
  apps/desktop/assets/icon.png; do
  if [[ ! -f "$required_file" ]]; then
    echo "Required release file is missing: $required_file" >&2
    exit 1
  fi
done

if ! grep -Fq "## [$desktop_version]" CHANGELOG.md; then
  echo "CHANGELOG.md has no entry for $desktop_version." >&2
  exit 1
fi

if [[ -n "$requested_tag" ]] && ! grep -Eq "^## \[$desktop_version\] - [0-9]{4}-[0-9]{2}-[0-9]{2}$" CHANGELOG.md; then
  echo "The $desktop_version changelog entry must contain its release date before tagging." >&2
  exit 1
fi

update_provider="$(node -p "require('./apps/desktop/electron-builder.config.cjs').publish?.[0]?.provider ?? ''")"
update_owner="$(node -p "require('./apps/desktop/electron-builder.config.cjs').publish?.[0]?.owner ?? ''")"
update_repository="$(node -p "require('./apps/desktop/electron-builder.config.cjs').publish?.[0]?.repo ?? ''")"
if [[ "$update_provider" != "github" || "$update_owner" != "ChrBoebel" || "$update_repository" != "chelaro" ]]; then
  echo "Desktop release must target the reviewed public GitHub update channel." >&2
  exit 1
fi

git diff --check
bash scripts/check-repository-safety.sh
echo "Release readiness checks passed for $expected_tag."
