#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" = "Linux" ]; then
    pnpm --package=playwright-core@1.61.1 dlx playwright-core install --with-deps chromium
else
    pnpm --package=playwright-core@1.61.1 dlx playwright-core install chromium
fi
