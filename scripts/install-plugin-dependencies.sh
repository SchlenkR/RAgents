#!/usr/bin/env bash
set -euo pipefail

target="${1:?Zielordner angeben}"
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$target"
target="$(cd "$target" && pwd)"

found=""
for script in "$root"/plugins/*/install.sh; do
    [ -f "$script" ] || continue
    plugin="$(basename "$(dirname "$script")")"
    echo "== $plugin"
    bash "$script" "$target"
    found="1"
done

if [ -z "$found" ]; then
    echo "Kein Plugin bringt eine install.sh mit." >&2
    exit 1
fi
