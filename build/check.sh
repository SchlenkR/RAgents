#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

pnpm build:agent
pnpm --filter @aicontainer/ai test
pnpm --filter @aicontainer/agent-core test
pnpm --filter @aicontainer/agent test
pnpm --filter @aicontainer/ragents check
pnpm --filter @aicontainer/server test
pnpm --filter @aicontainer/web test
pnpm --filter ragents-vscode test
pnpm -r typecheck
pnpm lint
bash build/homepage.sh --check
exec pnpm build:web
