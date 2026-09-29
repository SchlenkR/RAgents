#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
selection=""
dev=""

for arg in "$@"; do
    case "$arg" in
        --dev) dev="1" ;;
        -*) echo "Unknown argument: $arg (allowed: <profile>, <path to ragents.config.<profile>.ts>, --dev)" >&2; exit 1 ;;
        *) selection="$arg" ;;
    esac
done

available_profiles() {
    for file in "$root"/ragents.config.*.ts; do
        [ -f "$file" ] || continue
        name="${file##*/ragents.config.}"
        name="${name%.ts}"
        [ "$name" = "example" ] && continue
        echo "$name"
    done
}

if [ -z "$selection" ] && [ -n "${PRODUCT_PROFILE_FILE:-}" ]; then
    selection="$PRODUCT_PROFILE_FILE"
    echo "== Profile file comes from the environment: $selection"
elif [ -z "$selection" ] && [ -n "${PRODUCT_PROFILE:-}" ]; then
    selection="$PRODUCT_PROFILE"
    echo "== Profile comes from the environment: $selection"
elif [ -z "$selection" ]; then
    profiles=$(available_profiles)
    if [ -z "$profiles" ]; then
        echo "No configuration found: $root/ragents.config.<profile>.ts" >&2
        exit 1
    fi
    echo "Which variant? (profile name or path to a ragents.config.<profile>.ts)"
    index=0
    while read -r name; do
        index=$((index + 1))
        echo "  $index) $name"
    done <<< "$profiles"
    read -r -p "> " choice
    index=0
    while read -r name; do
        index=$((index + 1))
        if [ "$choice" = "$index" ] || [ "$choice" = "$name" ]; then selection="$name"; fi
    done <<< "$profiles"
    if [ -z "$selection" ]; then selection="$choice"; fi
    if [ -z "$selection" ]; then
        echo "Invalid choice." >&2
        exit 1
    fi
fi

# A profile is a name (file in the repo) or a path to a ragents.config.<profile>.ts anywhere.
case "$selection" in
    */*|*.ts)
        config_file="$(cd "$(dirname "$selection")" 2>/dev/null && pwd)/$(basename "$selection")" || config_file="$selection"
        profile="$(basename "$config_file")"
        profile="${profile#ragents.config.}"
        profile="${profile%.ts}"
        if [ "$(basename "$config_file")" != "ragents.config.$profile.ts" ] || [ -z "$profile" ]; then
            echo "A profile file is named ragents.config.<profile>.ts: $selection" >&2
            exit 1
        fi
        ;;
    *)
        profile="$selection"
        config_file="$root/ragents.config.$profile.ts"
        ;;
esac
if [ ! -f "$config_file" ]; then
    echo "Configuration missing: $config_file" >&2
    exit 1
fi

# There is deliberately no .env - secrets come from the shell environment, the configuration reads them with env("NAME").
export PRODUCT_PROFILE="$profile"
export PRODUCT_PROFILE_FILE="$config_file"
echo "== Profile $profile ($config_file)"

PORT="$(cd "$root/apps/server" && node --import tsx --input-type=module -e '
import "./src/host-resolution.ts";
import { pathToFileURL } from "node:url";
import { assertServerPortAvailable } from "./src/startup.ts";
try {
    const { config } = await import(pathToFileURL(process.env.PRODUCT_PROFILE_FILE).href);
    const port = Number(process.env.PORT || config.host.PORT);
    await assertServerPortAvailable(port);
    console.log(port);
} catch (error) {
    console.error(`RAgents does not start: ${error.message}`);
    process.exit(1);
}
')"
export PORT
DATA_DIR="$(cd "$root/apps/server" && node --import tsx --input-type=module -e '
import "./src/host-resolution.ts";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDataDirectoryIsolated, defaultDataDirectory } from "./src/startup.ts";
try {
    const { config } = await import(pathToFileURL(process.env.PRODUCT_PROFILE_FILE).href);
    const configured = config.host.DATA_DIR;
    const reference = configured?.kind === "environment";
    const value = reference ? process.env[configured.name] : configured;
    if (reference && value === undefined) throw new Error(`host.DATA_DIR refers to the unset environment variable ${configured.name}.`);
    const directory = path.resolve(process.env.DATA_DIR ?? value ?? defaultDataDirectory(process.env.PRODUCT_PROFILE));
    await assertDataDirectoryIsolated(directory);
    console.log(directory);
} catch (error) {
    console.error(`RAgents does not start: ${error.message}`);
    process.exit(1);
}
')"
export DATA_DIR

cd "$root"

if [ -n "$dev" ]; then
    # In dev mode the UI always runs on the backend port plus 1000.
    web_port=$((PORT + 1000))
    (cd "$root/apps/server" && node --import tsx --input-type=module -e '
import { assertServerPortAvailable } from "./src/startup.ts";
try { await assertServerPortAvailable(Number(process.argv[1])); }
catch (error) {
    console.error(`RAgents UI does not start: ${error.message}`);
    process.exit(1);
}
' "$web_port")
    # The server loads only bundles; before every start, whatever no longer matches its sources is rebuilt.
    pnpm build:plugins
    export API_TARGET="http://localhost:$PORT"
    export RAGENTS_DEV=1
    echo "== Dev mode (server http://localhost:$PORT, UI http://localhost:$web_port, data: $DATA_DIR)"
    trap 'kill 0' EXIT
    pnpm build:plugins --watch &
    pnpm dev:server &
    pnpm dev:web --port "$web_port" --strictPort &
    wait
else
    pnpm build:plugins
    # One web for all profiles: it is built only if it is missing or no longer matches its sources.
    web_problem="$(cd "$root/apps/server" && node --import tsx --input-type=module -e '
import { hostRoot } from "./src/host-version.ts";
import { hostWebDirectory, hostWebProblem, isCheckout } from "./src/host-web.ts";
console.log(hostWebProblem(hostWebDirectory(hostRoot()), hostRoot(), isCheckout(hostRoot())) ?? "");
')"
    if [ -n "$web_problem" ]; then
        echo "== $web_problem; building web"
        pnpm build:web
    fi
    # scripts/vscode/install-local.sh recognizes the manually started servers by this.
    export RAGENTS_LAUNCH="start.sh"
    echo "== Starting server: http://localhost:$PORT (data: $DATA_DIR)"
    exec pnpm start
fi
