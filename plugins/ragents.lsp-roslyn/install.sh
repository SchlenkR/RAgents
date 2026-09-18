#!/usr/bin/env bash
set -euo pipefail

target="${1:?Zielordner angeben}"
version="${ROSLYN_LANGUAGE_SERVER_VERSION:-5.4.0-2.26179.14}"
feed="https://pkgs.dev.azure.com/azure-public/vside/_packaging/vs-impl/nuget/v3/flat2"

mkdir -p "$target"
target="$(cd "$target" && pwd)"

echo "== Roslyn Language Server $version"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -sSL --fail -o "$tmp/roslyn.nupkg" \
    "$feed/microsoft.codeanalysis.languageserver.neutral/$version/microsoft.codeanalysis.languageserver.neutral.$version.nupkg"
rm -rf "$target/roslyn"
mkdir -p "$target/roslyn"
unzip -q "$tmp/roslyn.nupkg" "content/LanguageServer/neutral/*" -d "$tmp/roslyn"
mv "$tmp/roslyn/content/LanguageServer/neutral/"* "$target/roslyn/"
test -f "$target/roslyn/Microsoft.CodeAnalysis.LanguageServer.dll"

echo "ROSLYN_LANGUAGE_SERVER=$target/roslyn/Microsoft.CodeAnalysis.LanguageServer.dll"
