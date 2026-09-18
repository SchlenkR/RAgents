#!/usr/bin/env bash
set -euo pipefail

target="${1:?Zielordner angeben}"
version="${FSAUTOCOMPLETE_VERSION:-0.83.0}"

mkdir -p "$target"
target="$(cd "$target" && pwd)"

echo "== fsautocomplete $version"
rm -rf "$target/fsautocomplete"
dotnet tool install fsautocomplete --version "$version" --tool-path "$target/fsautocomplete" \
    --add-source https://api.nuget.org/v3/index.json --ignore-failed-sources
test -x "$target/fsautocomplete/fsautocomplete"

echo "FSHARP_LANGUAGE_SERVER=$target/fsautocomplete/fsautocomplete"
