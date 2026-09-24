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
bash build/homepage.sh --check
pnpm build:web
# Das Paket und ein geholter Stand tragen das fertige Web des Hosts; ihre Prüfungen laufen deshalb nach dem Web-Build.
exec pnpm --filter @ragents/host exec node --import tsx --test ../../scripts/package/build-package.test.ts ../../scripts/package/publish-package.test.ts ../../scripts/vscode/publish-extension.test.ts ../../scripts/remote/connect-start.test.ts
