#!/usr/bin/env bash
# VS Code testen: Erweiterung aus dem Checkout packen und installieren, Bundles und Web neu bauen, von Hand gestartete Server neu starten.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$root"
pnpm package:vscode
vsix="$(ls -t dist/ragents-vscode-*.vsix | head -1)"

code_binary="$(command -v code || echo '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code')"
if [ ! -x "$code_binary" ]; then
    echo "VS Code nicht gefunden: $code_binary" >&2
    exit 1
fi
"$code_binary" --install-extension "$vsix" --force

# Ein Host aus diesem Checkout prüft beim Start, dass Bundles und Web zu ihren Quellen passen; beides hier nachziehen.
pnpm build:plugins
web_problem="$(cd "$root/apps/server" && node --import tsx --input-type=module -e '
import { hostRoot } from "./src/host-version.ts";
import { hostWebDirectory, hostWebProblem, isCheckout } from "./src/host-web.ts";
console.log(hostWebProblem(hostWebDirectory(hostRoot()), hostRoot(), isCheckout(hostRoot())) ?? "");
')"
if [ -n "$web_problem" ]; then
    echo "== $web_problem; Web bauen"
    pnpm build:web
fi

# Variablen des umgebenden VS Code (Task-Terminal) dürfen die Server nicht erben, sonst hängen sie am Aufrufer.
inherited=()
while IFS= read -r name; do inherited+=("-u" "$name"); done < <(env | sed -n -e 's/^\(VSCODE_[A-Z_]*\)=.*/\1/p' -e 's/^\(ELECTRON_[A-Z_]*\)=.*/\1/p')

# Startet einen Prozess in eigener Sitzung; er überlebt das Ende des Tasks.
detached() {
    local log="$1"
    shift
    perl -MPOSIX -e 'POSIX::setsid() != -1 or die "setsid: $!"; my $pid = fork(); defined $pid or die "fork: $!"; exit 0 if $pid; exec @ARGV or die "exec: $!"' -- \
        env "${inherited[@]}" "$@" > "$log" 2>&1 < /dev/null
}

variable() {
    ps eww -o command= -p "$1" | tr ' ' '\n' | sed -n "s/^$2=//p" | head -1
}

# Von Hand gestartete Server (scripts/start.sh) tragen RAGENTS_LAUNCH; die Hosts der Erweiterung nicht, die startet sie beim Reload selbst neu.
restarted=()
for pid in $(pgrep -u "$(id -u)" -f "src/main.ts"); do
    port="$(variable "$pid" PORT)"
    profile_file="$(variable "$pid" PRODUCT_PROFILE_FILE)"
    data_dir="$(variable "$pid" DATA_DIR)"
    [ -n "$port" ] && [ -n "$profile_file" ] && [ -n "$data_dir" ] && [ -n "$(variable "$pid" RAGENTS_LAUNCH)" ] || continue
    printf '%s\n' "${restarted[@]:-}" | grep -qx "$port" && continue
    restarted+=("$port")
    echo "== Server $port ($profile_file) stoppen"
    tree=("$pid")
    parent="$(ps -o ppid= -p "$pid" | tr -d ' ')"
    while [ -n "$parent" ] && [ "$parent" != "1" ] && ps -o command= -p "$parent" | grep -qE "pnpm|tsx|start\.sh"; do
        tree+=("$parent")
        parent="$(ps -o ppid= -p "$parent" | tr -d ' ')"
    done
    kill "${tree[@]}" 2>/dev/null || true
    for _ in $(seq 1 30); do
        lsof -nP -iTCP:"$port" -sTCP:LISTEN > /dev/null 2>&1 || break
        sleep 1
    done
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN > /dev/null 2>&1; then
        echo "Port $port ist nach 30 s noch belegt; Server nicht neu gestartet" >&2
        continue
    fi
    mkdir -p "$data_dir/logs"
    log="$data_dir/logs/server-$(date +%Y%m%d-%H%M%S).log"
    echo "== Server $port starten (Log: $log)"
    # Port und Datenordner des alten Prozesses gelten weiter, auch wenn sie nicht aus der Profildatei kamen.
    detached "$log" PORT="$port" DATA_DIR="$data_dir" bash "$root/scripts/start.sh" "$profile_file"
    for _ in $(seq 1 240); do
        curl -fsS -m 2 "http://localhost:$port/health" > /dev/null 2>&1 && break
        sleep 0.5
    done
    if curl -fsS -m 2 "http://localhost:$port/health" > /dev/null 2>&1; then
        echo "== Server bereit unter http://localhost:$port"
    else
        echo "Der Server unter http://localhost:$port antwortet nach zwei Minuten nicht; Ende von $log:" >&2
        tail -20 "$log" >&2
    fi
done

# Der Reload beendet die Hosts der Erweiterung und startet sie mit dem neuen Stand; die Erweiterung nimmt die Anforderung als URI entgegen.
echo "== Installiert: $vsix; VS Code lädt das Fenster neu und startet die Umgebungen der Konfiguration."
open "vscode://purestate.ragents-vscode/reload" || echo "Fenster nicht neu geladen; in VS Code 'Developer: Reload Window' ausführen." >&2
