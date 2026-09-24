#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

pnpm build:agent
pnpm build:plugins
exec pnpm build:web
