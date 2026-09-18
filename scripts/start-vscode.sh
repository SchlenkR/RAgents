#!/usr/bin/env bash
set -euo pipefail

# Startet eine eigene VS-Code-Instanz mit der RAgents-Erweiterung aus apps/vscode gegen einen laufenden Server.
# Aufruf: scripts/start-vscode.sh [<profil>|<pfad zu ragents.config.<profil>.ts>|<url>]   (Standard: core); ein Profil startet den Server mit, falls er nicht läuft.

root="$(cd "$(dirname "$0")/.." && pwd)"
target="${1:-core}"

profile=""
case "$target" in
    http://*|https://*) url="$target" ;;
    */*|*.ts) profile="$target"; config_file="$target" ;;
    *) profile="$target"; config_file="$root/ragents.config.$target.ts" ;;
esac
if [ -n "$profile" ]; then
    if [ ! -f "$config_file" ]; then
        echo "Konfiguration fehlt: $config_file" >&2
        exit 1
    fi
    port="$(cd "$root/apps/server" && node --import tsx --input-type=module -e '
import "./src/host-resolution.ts";
import { pathToFileURL } from "node:url";
const { config } = await import(pathToFileURL(process.argv[1]).href);
console.log(Number(process.env.PORT || config.host.PORT));
' "$config_file")"
    url="http://localhost:$port"
fi

code_binary="${VSCODE_EXECUTABLE:-/Applications/Visual Studio Code.app/Contents/MacOS/Code}"
if [ ! -x "$code_binary" ]; then
    echo "VS Code nicht gefunden: $code_binary (VSCODE_EXECUTABLE setzen)" >&2
    exit 1
fi

# Eigener Benutzerordner, damit Layout und Anmeldung der Testinstanz erhalten bleiben; kurz, weil VS Code darin einen Unix-Socket anlegt.
user_dir="${RAGENTS_VSCODE_USER_DIR:-$HOME/.local/share/ragents/vscode}"
mkdir -p "$user_dir/User" "$user_dir/extensions"

# Variablen des umgebenden VS Code (Task-Terminal, Extension-Host) dürfen Server und Instanz nicht erben, sonst hängen sie sich an den Aufrufer.
inherited=()
while IFS= read -r name; do inherited+=("-u" "$name"); done < <(env | sed -n -e 's/^\(VSCODE_[A-Z_]*\)=.*/\1/p' -e 's/^\(ELECTRON_[A-Z_]*\)=.*/\1/p')

# Startet einen Prozess in eigener Sitzung und als Nicht-Sitzungsführer: er kann sich kein Terminal greifen und überlebt das Ende des Aufrufers (etwa des VS-Code-Tasks).
detached() {
    local log="$1"
    shift
    perl -MPOSIX -e 'POSIX::setsid() != -1 or die "setsid: $!"; my $pid = fork(); defined $pid or die "fork: $!"; exit 0 if $pid; exec @ARGV or die "exec: $!"' -- \
        env "${inherited[@]}" "$@" > "$log" 2>&1 < /dev/null
}

server_log="$user_dir/server.log"
if curl -fsS -m 2 "$url/health" > /dev/null 2>&1; then
    echo "== Server läuft unter $url"
elif [ -n "$profile" ]; then
    echo "== Server $profile starten (Log: $server_log)"
    detached "$server_log" bash "$root/scripts/start.sh" "$profile"
    for _ in $(seq 1 240); do
        curl -fsS -m 2 "$url/health" > /dev/null 2>&1 && break
        sleep 0.5
    done
    if ! curl -fsS -m 2 "$url/health" > /dev/null 2>&1; then
        echo "Der Server unter $url antwortet nach zwei Minuten nicht; Ende von $server_log:" >&2
        tail -20 "$server_log" >&2
        exit 1
    fi
    echo "== Server bereit unter $url"
else
    echo "Hinweis: unter $url antwortet kein Server; die Erweiterung verbindet sich, sobald er läuft." >&2
fi

# Eine laufende Testinstanz wird ersetzt, damit Skript und Task immer den frischen Build und die neue Serveradresse zeigen.
if pgrep -f -- "--user-data-dir=$user_dir" > /dev/null; then
    echo "== Laufende Testinstanz beenden"
    pkill -f -- "--user-data-dir=$user_dir" || true
    for _ in $(seq 1 20); do
        pgrep -f -- "--user-data-dir=$user_dir" > /dev/null || break
        sleep 0.5
    done
    if pgrep -f -- "--user-data-dir=$user_dir" > /dev/null; then pkill -9 -f -- "--user-data-dir=$user_dir" || true; sleep 1; fi
fi

echo "== Erweiterung bauen"
(cd "$root" && pnpm --filter ragents-vscode build)

settings="$user_dir/User/settings.json" url="$url" node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const file = process.env.settings;
let current = {};
try { current = JSON.parse(readFileSync(file, "utf8")); } catch {}
const next = {
    "workbench.startupEditor": "none",
    "security.workspace.trust.enabled": false,
    "update.mode": "none",
    "telemetry.telemetryLevel": "off",
    "extensions.autoUpdate": false,
    ...current,
    "ragents.serverUrl": process.env.url,
};
writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
'

echo "== VS-Code-Testinstanz gegen $url (Benutzerordner: $user_dir)"
echo "   RAgents-Symbol in der Aktivitätsleiste öffnen; die Spalte liegt in der zweiten Seitenleiste."
detached "$user_dir/start.log" "$code_binary" \
    --extensionDevelopmentPath="$root/apps/vscode" \
    --user-data-dir="$user_dir" \
    --extensions-dir="$user_dir/extensions" \
    --disable-workspace-trust --skip-welcome --skip-release-notes \
    "$root"
echo "   Ausgabe der Instanz: $user_dir/start.log"
