#!/usr/bin/env bash
set -euo pipefail

output="$(pnpm run lint 2>&1)"
if rg -q "@typescript-eslint/no-unused-vars" <<<"$output"; then
  printf "%s\n" "$output" | rg "@typescript-eslint/no-unused-vars" || true
  exit 1
fi

exit 0
