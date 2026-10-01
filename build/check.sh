#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

pnpm build:agent
pnpm --filter @ragents/ai test
pnpm --filter @ragents/agent test
pnpm --filter @ragents/engine check
pnpm --filter @ragents/workspace-executor test
pnpm --filter @ragents/host test
pnpm --filter @ragents/web test
pnpm --filter ragents-vscode test
pnpm -r typecheck
pnpm lint
pnpm check:release
bash build/homepage.sh --check
pnpm build:web
# The package and a fetched build carry the host's finished web app, so their checks run after the web build.
exec pnpm --filter @ragents/host exec node --import tsx --test ../../scripts/package/build-package.test.ts ../../scripts/package/publish-package.test.ts ../../scripts/package/tools-package.test.ts ../../scripts/vscode/publish-extension.test.ts ../../scripts/vscode/bundle-bash.test.ts ../../scripts/vscode/bundle-rg.test.ts ../../scripts/remote/connect-start.test.ts ../../scripts/workspace-client/*.test.ts
