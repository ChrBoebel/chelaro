#!/usr/bin/env bash

set -euo pipefail

forbidden_data_pattern='(^|/)(data|uploads|quarantine|exports)/|\.(csv|heic|pdf|tiff|xls|xlsx)$'
tracked_sensitive_files="$({
  git ls-files | grep -Ei "${forbidden_data_pattern}" || true
  git ls-files | grep -Ei '(^|/)\.env($|\.)' | grep -Eiv '(^|/)\.env\.example$' || true
} | sort -u)"

if [[ -n "${tracked_sensitive_files}" ]]; then
  echo "Refusing tracked financial data or local secret files:" >&2
  echo "${tracked_sensitive_files}" >&2
  exit 1
fi

aws_pattern='AKIA''[0-9A-Z]{16}'
github_pattern='gh''[pousr]_[A-Za-z0-9]{36,255}'
openai_pattern='sk-''proj-[A-Za-z0-9_-]{20,}'
private_key_pattern='-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
secret_pattern="${aws_pattern}|${github_pattern}|${openai_pattern}|${private_key_pattern}"

if git grep -IEn "${secret_pattern}" -- . ':(exclude)pnpm-lock.yaml' ':(exclude)apps/api/uv.lock'; then
  echo "Potential credential material found in tracked source." >&2
  exit 1
fi

echo "Repository safety checks passed."
