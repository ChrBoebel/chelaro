#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_directory/.." && pwd)"
runtime_root="$repository_root/apps/desktop/.runtime"
staging_root="$(mktemp -d "${TMPDIR:-/tmp}/finance-os-runtime.XXXXXX")"

cleanup() {
  rm -rf "$staging_root"
}
trap cleanup EXIT

pnpm --dir "$repository_root" build:web
pnpm --dir "$repository_root" smoke:web:standalone
pnpm --dir "$repository_root" build:agent-host
pnpm --dir "$repository_root" --filter @finance-os/agent-host --prod --legacy deploy "$staging_root/agent-host"
agent_workspace_link="$staging_root/agent-host/node_modules/.pnpm/node_modules/@finance-os/agent-host"
if [[ -L "$agent_workspace_link" ]]; then
  unlink "$agent_workspace_link"
elif [[ -e "$agent_workspace_link" ]]; then
  echo "Refusing to remove a non-link agent workspace entry." >&2
  exit 1
fi
uv run --project "$repository_root/apps/api" pyinstaller \
  --noconfirm \
  --clean \
  --distpath "$staging_root/api" \
  --workpath "$staging_root/pyinstaller" \
  "$repository_root/apps/api/finance-os-api.spec"

web_source="$repository_root/apps/web/.next/standalone"
web_destination="$staging_root/web"
mkdir -p "$web_destination/apps/web/.next"
cp -R "$web_source/." "$web_destination/"
cp -R "$repository_root/apps/web/public" "$web_destination/apps/web/public"
cp -R "$repository_root/apps/web/.next/static" "$web_destination/apps/web/.next/static"

if [[ ! -x "$staging_root/api/finance-os-api" ]]; then
  echo "Embedded API executable was not generated." >&2
  exit 1
fi
if [[ ! -f "$web_destination/apps/web/server.js" ]]; then
  echo "Standalone Next.js server was not generated." >&2
  exit 1
fi
if [[ ! -f "$staging_root/agent-host/dist/src/main.js" ]]; then
  echo "Embedded finance agent host was not generated." >&2
  exit 1
fi

if [[ "$runtime_root" != "$repository_root/apps/desktop/.runtime" ]]; then
  echo "Refusing to replace unexpected runtime path: $runtime_root" >&2
  exit 1
fi
mkdir -p "$runtime_root"
find "$runtime_root" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -R "$staging_root/api" "$runtime_root/api"
cp -R "$staging_root/web" "$runtime_root/web"
cp -R "$staging_root/agent-host" "$runtime_root/agent-host"

if [[ -n "$(find -L "$runtime_root" -type l -print -quit)" ]]; then
  echo "Embedded runtime contains a broken symbolic link." >&2
  exit 1
fi

echo "Prepared embedded Chelaro runtime in $runtime_root"
