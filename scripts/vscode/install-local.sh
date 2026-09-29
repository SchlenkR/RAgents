#!/usr/bin/env bash
# Test VS Code: package and install the extension from the checkout, rebuild bundles and web, restart manually started servers.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$root"
pnpm package:vscode
# Like the Marketplace: this platform's version including rg, otherwise the universal one.
version="$(node -p 'require("./apps/vscode/package.json").version')"
target="$(node -p 'process.platform + "-" + process.arch')"
vsix="dist/ragents-vscode-$target-$version.vsix"
[ -f "$vsix" ] || vsix="dist/ragents-vscode-$version.vsix"

code_binary="$(command -v code || echo '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code')"
if [ ! -x "$code_binary" ]; then
    echo "VS Code not found: $code_binary" >&2
    exit 1
fi
"$code_binary" --install-extension "$vsix" --force

# A host from this checkout checks at startup that bundles and web match their sources; bring both up to date here.
pnpm build:plugins
web_problem="$(cd "$root/apps/server" && node --import tsx --input-type=module -e '
import { hostRoot } from "./src/host-version.ts";
import { hostWebDirectory, hostWebProblem, isCheckout } from "./src/host-web.ts";
console.log(hostWebProblem(hostWebDirectory(hostRoot()), hostRoot(), isCheckout(hostRoot())) ?? "");
')"
if [ -n "$web_problem" ]; then
    echo "== $web_problem; building web"
    pnpm build:web
fi

# The servers must not inherit variables of the surrounding VS Code (task terminal), otherwise they hang on the caller.
inherited=()
while IFS= read -r name; do inherited+=("-u" "$name"); done < <(env | sed -n -e 's/^\(VSCODE_[A-Z_]*\)=.*/\1/p' -e 's/^\(ELECTRON_[A-Z_]*\)=.*/\1/p')

# Starts a process in its own session; it survives the end of the task.
detached() {
    local log="$1"
    shift
    perl -MPOSIX -e 'POSIX::setsid() != -1 or die "setsid: $!"; my $pid = fork(); defined $pid or die "fork: $!"; exit 0 if $pid; exec @ARGV or die "exec: $!"' -- \
        env "${inherited[@]}" "$@" > "$log" 2>&1 < /dev/null
}

variable() {
    ps eww -o command= -p "$1" | tr ' ' '\n' | sed -n "s/^$2=//p" | head -1
}

# Manually started servers (scripts/start.sh) carry RAGENTS_LAUNCH; the extension's hosts do not, the extension restarts them itself on reload.
restarted=()
for pid in $(pgrep -u "$(id -u)" -f "src/main.ts"); do
    port="$(variable "$pid" PORT)"
    profile_file="$(variable "$pid" PRODUCT_PROFILE_FILE)"
    data_dir="$(variable "$pid" DATA_DIR)"
    [ -n "$port" ] && [ -n "$profile_file" ] && [ -n "$data_dir" ] && [ -n "$(variable "$pid" RAGENTS_LAUNCH)" ] || continue
    printf '%s\n' "${restarted[@]:-}" | grep -qx "$port" && continue
    restarted+=("$port")
    echo "== Stopping server $port ($profile_file)"
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
        echo "Port $port is still in use after 30 s; server not restarted" >&2
        continue
    fi
    mkdir -p "$data_dir/logs"
    log="$data_dir/logs/server-$(date +%Y%m%d-%H%M%S).log"
    echo "== Starting server $port (log: $log)"
    # Port and data folder of the old process still apply, even if they did not come from the profile file.
    detached "$log" PORT="$port" DATA_DIR="$data_dir" bash "$root/scripts/start.sh" "$profile_file"
    for _ in $(seq 1 240); do
        curl -fsS -m 2 "http://localhost:$port/health" > /dev/null 2>&1 && break
        sleep 0.5
    done
    if curl -fsS -m 2 "http://localhost:$port/health" > /dev/null 2>&1; then
        echo "== Server ready at http://localhost:$port"
    else
        echo "The server at http://localhost:$port does not respond after two minutes; end of $log:" >&2
        tail -20 "$log" >&2
    fi
done

# The reload stops the extension's hosts and starts them with the new state; the extension receives the request as a URI.
echo "== Installed: $vsix; VS Code reloads the window and starts the configured servers."
open "vscode://purestate.ragents-vscode/reload" || echo "Window not reloaded; run 'Developer: Reload Window' in VS Code." >&2
