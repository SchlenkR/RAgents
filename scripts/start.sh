#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
selection=""
dev=""

for arg in "$@"; do
    case "$arg" in
        --dev) dev="1" ;;
        -*) echo "Unbekanntes Argument: $arg (erlaubt: <profil>, <pfad zu ragents.config.<profil>.ts>, --dev)" >&2; exit 1 ;;
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
    echo "== Profildatei kommt aus der Umgebung: $selection"
elif [ -z "$selection" ] && [ -n "${PRODUCT_PROFILE:-}" ]; then
    selection="$PRODUCT_PROFILE"
    echo "== Profil kommt aus der Umgebung: $selection"
elif [ -z "$selection" ]; then
    profiles=$(available_profiles)
    if [ -z "$profiles" ]; then
        echo "Keine Konfiguration gefunden: $root/ragents.config.<profil>.ts" >&2
        exit 1
    fi
    echo "Welche Variante? (Profilname oder Pfad zu einer ragents.config.<profil>.ts)"
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
        echo "Ungültige Auswahl." >&2
        exit 1
    fi
fi

# Ein Profil ist ein Name (Datei im Repo) oder ein Pfad zu einer ragents.config.<profil>.ts an beliebiger Stelle.
case "$selection" in
    */*|*.ts)
        config_file="$(cd "$(dirname "$selection")" 2>/dev/null && pwd)/$(basename "$selection")" || config_file="$selection"
        profile="$(basename "$config_file")"
        profile="${profile#ragents.config.}"
        profile="${profile%.ts}"
        if [ "$(basename "$config_file")" != "ragents.config.$profile.ts" ] || [ -z "$profile" ]; then
            echo "Eine Profildatei heißt ragents.config.<profil>.ts: $selection" >&2
            exit 1
        fi
        ;;
    *)
        profile="$selection"
        config_file="$root/ragents.config.$profile.ts"
        ;;
esac
if [ ! -f "$config_file" ]; then
    echo "Konfiguration fehlt: $config_file" >&2
    exit 1
fi

# Eine .env gibt es bewusst nicht - Secrets kommen aus der Shell-Umgebung, die Konfiguration liest sie mit env("NAME").
export PRODUCT_PROFILE="$profile"
export PRODUCT_PROFILE_FILE="$config_file"
echo "== Profil $profile ($config_file)"

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
    console.error(`RAgents startet nicht: ${error.message}`);
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
    if (reference && value === undefined) throw new Error(`host.DATA_DIR verweist auf die nicht gesetzte Umgebungsvariable ${configured.name}.`);
    const directory = path.resolve(process.env.DATA_DIR ?? value ?? defaultDataDirectory(process.env.PRODUCT_PROFILE));
    await assertDataDirectoryIsolated(directory);
    console.log(directory);
} catch (error) {
    console.error(`RAgents startet nicht: ${error.message}`);
    process.exit(1);
}
')"
export DATA_DIR

cd "$root"

if [ -n "$dev" ]; then
    # Die Oberfläche läuft im Dev-Modus fest auf Backendport plus 1000.
    web_port=$((PORT + 1000))
    (cd "$root/apps/server" && node --import tsx --input-type=module -e '
import { assertServerPortAvailable } from "./src/startup.ts";
try { await assertServerPortAvailable(Number(process.argv[1])); }
catch (error) {
    console.error(`RAgents-Oberfläche startet nicht: ${error.message}`);
    process.exit(1);
}
' "$web_port")
    export API_TARGET="http://localhost:$PORT"
    echo "== Dev-Modus (Server http://localhost:$PORT, Oberfläche http://localhost:$web_port, Daten: $DATA_DIR)"
    trap 'kill 0' EXIT
    pnpm dev:server &
    pnpm dev:web --port "$web_port" --strictPort &
    wait
else
    echo "== Frontend bauen"
    pnpm build:web
    echo "== Server starten: http://localhost:$PORT (Daten: $DATA_DIR)"
    exec pnpm start
fi
