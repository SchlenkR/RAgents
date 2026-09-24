#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

if [[ $# -gt 1 ]]; then
  echo "Aufruf: build/homepage.sh [--open|--check]" >&2
  exit 2
fi

case "${1-}" in
  --check)
    pnpm exec tsc -p scripts/homepage/tsconfig.homepage.json
    pnpm --filter @ragents/host exec node --import tsx --test ../../scripts/homepage/homepage-catalog.test.ts ../../scripts/homepage/homepage-examples.test.ts ../../scripts/homepage/homepage-extensions.test.ts ../../scripts/homepage/homepage-llms.test.ts ../../scripts/homepage/homepage-run-api.test.ts ../../scripts/homepage/homepage-export.test.ts ../../scripts/homepage/homepage-guide.test.ts ../../scripts/homepage/homepage-mini-app.test.ts ../../scripts/agent/journal.test.ts ../../scripts/agent/agent-cli.test.ts ../../scripts/remote/connect.test.ts ../../scripts/remote/start.test.ts ../../scripts/workspace-client/run-workspace-client.test.ts
    exec pnpm --filter @ragents/host exec node --import tsx ../../scripts/homepage/generate-homepage.ts --check
    ;;
  ""|--open) ;;
  *)
    echo "Aufruf: build/homepage.sh [--open|--check]" >&2
    exit 2
    ;;
esac

pnpm --filter @ragents/host exec node --import tsx ../../scripts/homepage/generate-homepage.ts

if [[ "${1-}" == --open ]]; then
  if [[ ! -f docs/homepage/dist/index.html ]]; then
    echo "Die Homepage unter docs/homepage/dist/index.html fehlt." >&2
    exit 1
  fi
  homepage_url="$(node --input-type=module -e 'import { pathToFileURL } from "node:url"; console.log(pathToFileURL(process.argv[1]).href);' "$PWD/docs/homepage/dist/index.html")"
  exec open "$homepage_url"
fi
