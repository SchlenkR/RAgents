#!/bin/sh
set -eu

fail() {
  printf 'RAgents: %s\n' "$*" >&2
  exit 1
}

install_ragents() {
  version=
  prefix="$HOME/.local"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version|--prefix)
        [ "$#" -ge 2 ] || fail "$1 requires a value."
        [ -n "$2" ] || fail "$1 requires a value."
        case "$1" in
          --version) version=${2#v} ;;
          --prefix) prefix=$2 ;;
        esac
        shift 2
        ;;
      --help|-h)
        printf '%s\n' 'Usage: install.sh [--version VERSION] [--prefix DIRECTORY]' 'Defaults: latest release, ~/.local. No administrator access required.'
        return
        ;;
      *) fail "Unknown option: $1" ;;
    esac
  done

  case "$prefix" in
    /*) ;;
    *) fail 'The installation prefix must be an absolute path.' ;;
  esac
  case "$(uname -s)" in
    Darwin) platform=darwin ;;
    Linux) platform=linux ;;
    *) fail 'Supported systems: macOS and Linux. On Windows, use install.ps1.' ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) fail 'Supported architectures: x64 and arm64.' ;;
  esac
  for tool in curl tar awk mktemp; do
    command -v "$tool" >/dev/null 2>&1 || fail "Required command not found: $tool"
  done
  if command -v sha256sum >/dev/null 2>&1; then
    checksum_tool=sha256sum
  elif command -v shasum >/dev/null 2>&1; then
    checksum_tool=shasum
  else
    fail 'Install sha256sum or shasum before continuing.'
  fi

  releases=https://github.com/SchlenkR/RAgents/releases
  if [ -z "$version" ]; then
    latest=$(curl --proto '=https' --tlsv1.2 -fsSL -o /dev/null -w '%{url_effective}' "$releases/latest")
    case "$latest" in
      "$releases/tag/v"*) version=${latest#"$releases/tag/v"} ;;
      *) fail 'Could not resolve the latest release.' ;;
    esac
  fi
  case "$version" in
    *[!0-9A-Za-z.-]*) fail 'Invalid version. Expected a version such as 0.1.0.' ;;
  esac
  printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' || fail 'Invalid version. Expected a version such as 0.1.0.'

  directory=ragents-$version-$platform-$arch
  asset=$directory.tar.gz
  versions=$prefix/lib/ragents
  destination=$versions/$directory
  mkdir -p "$versions" "$prefix/bin"
  lock=$versions/.install-lock
  mkdir "$lock" 2>/dev/null || fail "Another installation is active. If it was interrupted, remove $lock and retry."
  stage=
  trap 'test -z "$stage" || rm -rf "$stage"; rmdir "$lock"' 0
  trap 'exit 1' HUP INT TERM
  stage=$(mktemp -d "$versions/.install-XXXXXX")

  if [ ! -e "$destination" ]; then
    printf 'Downloading RAgents %s for %s-%s...\n' "$version" "$platform" "$arch"
    curl --proto '=https' --tlsv1.2 -fsSL "$releases/download/v$version/$asset" -o "$stage/$asset"
    curl --proto '=https' --tlsv1.2 -fsSL "$releases/download/v$version/SHA256SUMS" -o "$stage/SHA256SUMS"
    expected=$(awk -v name="$asset" '$2 == name { count++; hash=$1 } END { if (count == 1) print hash }' "$stage/SHA256SUMS")
    printf '%s\n' "$expected" | grep -Eq '^[0-9a-fA-F]{64}$' || fail "Missing or invalid checksum for $asset."
    if [ "$checksum_tool" = sha256sum ]; then
      actual=$(sha256sum "$stage/$asset" | awk '{ print $1 }')
    else
      actual=$(shasum -a 256 "$stage/$asset" | awk '{ print $1 }')
    fi
    [ "$actual" = "$expected" ] || fail "Checksum mismatch for $asset."
    tar -tzf "$stage/$asset" > "$stage/entries"
    awk -v root="$directory" '
      $0 != root && index($0, root "/") != 1 { exit 1 }
      /(^|\/)\.\.(\/|$)/ { exit 1 }
    ' "$stage/entries" || fail 'The archive contains unexpected paths.'
    tar -xzf "$stage/$asset" -C "$stage"
    [ -x "$stage/$directory/bin/ragents" ] || fail 'The archive has no executable bin/ragents.'
    "$stage/$directory/bin/ragents" --help >/dev/null || fail 'The downloaded application could not start.'
    mv "$stage/$directory" "$destination"
  else
    "$destination/bin/ragents" --help >/dev/null || fail "The existing installation at $destination could not start."
  fi

  executable=$(printf '%s' "$destination/bin/ragents" | sed "s/'/'\\\\''/g")
  printf '#!/bin/sh\nexec '\''%s'\'' "$@"\n' "$executable" > "$stage/ragents"
  chmod +x "$stage/ragents"
  [ ! -d "$prefix/bin/ragents" ] || fail "$prefix/bin/ragents is a directory."
  mv -f "$stage/ragents" "$prefix/bin/ragents"
  printf 'Installed RAgents %s. Run: ragents --help\n' "$version"
  case ":$PATH:" in
    *":$prefix/bin:"*) ;;
    *) printf 'Add this directory to your PATH: %s/bin\n' "$prefix" ;;
  esac
}

install_ragents "$@"
