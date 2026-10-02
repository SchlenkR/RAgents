#!/bin/sh
set -eu

releases=https://github.com/SchlenkR/RAgents/releases
rerun="curl -fsSL $releases/latest/download/install.sh | sh -s --"

fail() {
  printf 'RAgents: %s\n' "$*" >&2
  exit 1
}

usage() {
  printf '%s\n' \
    'Usage: install.sh [--local | --global] [--version VERSION] [--prefix DIRECTORY] [--uninstall]' \
    '' \
    '  --local        for the current user in ~/.local, without administrator access (default)' \
    '  --global       for all users in /usr/local; uses sudo only if that folder is not writable' \
    '  --version      install this release instead of the latest, for example 0.1.21' \
    '  --prefix       use DIRECTORY instead of the folder of the scope' \
    '  --uninstall    remove the command and all versions from the scope or prefix'
}

valid_version() {
  case "$1" in
    *[!0-9A-Za-z.-]*) return 1 ;;
  esac
  printf '%s\n' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
}

single_quoted() {
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
}

double_quoted() {
  printf '%s' "$1" | sed 's/[\\"$`]/\\&/g'
}

as_owner() {
  if [ "$elevate" = 1 ]; then sudo -- "$@"; else "$@"; fi
}

writable() {
  for target in "$@"; do
    while [ ! -e "$target" ] && [ ! -L "$target" ]; do target=$(dirname -- "$target"); done
    if [ ! -d "$target" ] || [ ! -w "$target" ]; then return 1; fi
  done
}

created_here() {
  [ -f "$1/bin/ragents" ] && [ ! -L "$1/bin/ragents" ] && grep -qF "exec '$(single_quoted "$1/lib/ragents/ragents-")" "$1/bin/ragents"
}

on_path() {
  rest=$PATH:
  while [ -n "$rest" ]; do
    entry=${rest%%:*}
    rest=${rest#*:}
    if [ -n "$entry" ] && [ "$entry" -ef "$prefix/bin" ]; then return 0; fi
  done
  return 1
}

path_hint() {
  bin=$prefix/bin
  if [ -n "$home" ] && [ "${bin#"$home"/}" != "$bin" ]; then
    shown=\$HOME/$(double_quoted "${bin#"$home"/}")
  else
    shown=$(double_quoted "$bin")
  fi
  case "${SHELL:-}" in
    */fish)
      printf '%s is not on your PATH. For fish, run this once:\n  fish_add_path %s\n' "$bin" "'$(printf '%s' "$bin" | sed "s/[\\\\']/\\\\&/g")'"
      return
      ;;
    */zsh) startup='~/.zshrc' ;;
    */bash) if [ "$platform" = darwin ]; then startup='~/.bash_profile'; else startup='~/.bashrc'; fi ;;
    *) startup='your shell startup file, for example ~/.profile' ;;
  esac
  printf '%s is not on your PATH. Add this line to %s, then open a new terminal:\n  export PATH="%s:$PATH"\n' "$bin" "$startup" "$shown"
}

report_others() {
  for other in "$local_prefix" /usr/local; do
    if [ -n "$other" ] && [ "$other" != "$prefix" ] && created_here "$other"; then
      if [ "$other" = /usr/local ]; then flag=' --global'; else flag=; fi
      printf 'Another RAgents installation remains in %s. Remove it with:\n  %s --uninstall%s\n' "$other" "$rerun" "$flag"
    fi
  done
  found=$(command -v ragents 2>/dev/null || true)
  if [ "$uninstall" = 1 ]; then
    if [ -n "$found" ]; then printf 'The ragents command on your PATH is now %s.\n' "$found"; fi
  elif [ -n "$found" ] && [ ! "$found" -ef "$prefix/bin/ragents" ]; then
    printf 'Warning: the ragents command on your PATH is %s, not this installation.\nRemove that copy, or put %s before it on your PATH.\n' "$found" "$prefix/bin"
  fi
}

prepare() {
  as_owner "$1/runtime/bin/node" --input-type=module -e 'const { pathToFileURL } = await import("node:url"); const { ensureHostLinks } = await import(pathToFileURL(process.argv[1]).href); ensureHostLinks(process.argv[2]);' "$1/app/scripts/package/host-links.mjs" "$1/app"
}

remove_installation() {
  [ ! -d "$versions/.install-lock" ] || fail "Another installation is active. If it was interrupted, remove $versions/.install-lock and retry."
  if [ -e "$shim" ] || [ -L "$shim" ]; then
    if created_here "$prefix"; then
      as_owner rm -f "$shim"
    else
      printf 'Kept %s: this installer did not create it.\n' "$shim"
    fi
  fi
  as_owner rm -rf "$versions"
  printf 'Removed RAgents from %s. Settings and runs stay in ~/.local/share/ragents of each user.\n' "$prefix"
}

install_ragents() {
  scope=
  version=
  prefix=
  uninstall=0
  elevate=0
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
      --local|--global)
        [ -z "$scope" ] || [ "$scope" = "${1#--}" ] || fail 'Choose either --local or --global.'
        scope=${1#--}
        shift
        ;;
      --uninstall)
        uninstall=1
        shift
        ;;
      --help|-h)
        usage
        return
        ;;
      *) fail "Unknown option: $1" ;;
    esac
  done
  scope=${scope:-local}
  if [ -n "$version" ]; then
    [ "$uninstall" = 0 ] || fail '--uninstall removes every version and takes no --version.'
    valid_version "$version" || fail 'Invalid version. Expected a version such as 0.1.0.'
  fi

  home=${HOME:-}
  local_prefix=${home:+$home/.local}
  if [ -z "$prefix" ]; then
    if [ "$scope" = global ]; then prefix=/usr/local; else prefix=$local_prefix; fi
    [ -n "$prefix" ] || fail 'HOME is not set. Choose a folder with --prefix.'
  fi
  case "$prefix" in
    /*) ;;
    *) fail 'The installation prefix must be an absolute path.' ;;
  esac
  case "$prefix" in
    /) ;;
    */) prefix=${prefix%"${prefix##*[!/]}"} ;;
  esac
  versions=$prefix/lib/ragents
  shim=$prefix/bin/ragents

  if [ "$uninstall" = 0 ]; then
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
    if [ -e "$shim" ] || [ -L "$shim" ]; then
      created_here "$prefix" || fail "$shim was not created by this installer, for example by npm. Remove it, or choose another --prefix."
    fi
  elif [ ! -e "$versions" ] && [ ! -e "$shim" ] && [ ! -L "$shim" ]; then
    printf 'No RAgents installation in %s.\n' "$prefix"
    report_others
    return
  fi

  if ! writable "$versions" "$prefix/bin"; then
    [ "$scope" = global ] || fail "$prefix is not writable for this user. Use --global for a folder that needs administrator access, or choose another --prefix."
    [ "$(id -u)" != 0 ] || fail "$prefix is not writable."
    command -v sudo >/dev/null 2>&1 || fail "$prefix is not writable and sudo is not available. Run the installer as root, or install for the current user with --local."
    printf 'Writing to %s needs administrator access; sudo may ask for your password.\n' "$prefix"
    sudo -v || fail 'Administrator access was not granted.'
    elevate=1
  fi
  if [ "$scope" = global ]; then umask 022; fi

  if [ "$uninstall" = 1 ]; then
    remove_installation
    report_others
    return
  fi

  if [ -z "$version" ]; then
    latest=$(curl --proto '=https' --tlsv1.2 -fsSL -o /dev/null -w '%{url_effective}' "$releases/latest")
    case "$latest" in
      "$releases/tag/v"*) version=${latest#"$releases/tag/v"} ;;
      *) fail 'Could not resolve the latest release.' ;;
    esac
    valid_version "$version" || fail 'Invalid version. Expected a version such as 0.1.0.'
  fi

  directory=ragents-$version-$platform-$arch
  asset=$directory.tar.gz
  destination=$versions/$directory
  as_owner mkdir -p "$versions" "$prefix/bin"
  lock=$versions/.install-lock
  as_owner mkdir "$lock" 2>/dev/null || fail "Another installation is active. If it was interrupted, remove $lock and retry."
  stage=
  download=
  trap 'test -z "$stage" || as_owner rm -rf "$stage"; test -z "$download" || rm -rf "$download"; as_owner rmdir "$lock"' 0
  trap 'exit 1' HUP INT TERM
  download=$(mktemp -d)
  stage=$(as_owner mktemp -d "$versions/.install-XXXXXX")
  as_owner chmod 755 "$stage"

  if [ ! -e "$destination" ]; then
    printf 'Downloading RAgents %s for %s-%s...\n' "$version" "$platform" "$arch"
    curl --proto '=https' --tlsv1.2 -fsSL "$releases/download/v$version/$asset" -o "$download/$asset"
    curl --proto '=https' --tlsv1.2 -fsSL "$releases/download/v$version/SHA256SUMS" -o "$download/SHA256SUMS"
    expected=$(awk -v name="$asset" '$2 == name { count++; hash=$1 } END { if (count == 1) print hash }' "$download/SHA256SUMS")
    printf '%s\n' "$expected" | grep -Eq '^[0-9a-fA-F]{64}$' || fail "Missing or invalid checksum for $asset."
    if [ "$checksum_tool" = sha256sum ]; then
      actual=$(sha256sum "$download/$asset" | awk '{ print $1 }')
    else
      actual=$(shasum -a 256 "$download/$asset" | awk '{ print $1 }')
    fi
    [ "$actual" = "$expected" ] || fail "Checksum mismatch for $asset."
    tar -tzf "$download/$asset" > "$download/entries"
    awk -v root="$directory" '
      $0 != root && index($0, root "/") != 1 { exit 1 }
      /(^|\/)\.\.(\/|$)/ { exit 1 }
    ' "$download/entries" || fail 'The archive contains unexpected paths.'
    as_owner tar --no-same-owner -xzf "$download/$asset" -C "$stage"
    [ -x "$stage/$directory/bin/ragents" ] || fail 'The archive has no executable bin/ragents.'
    "$stage/$directory/bin/ragents" --help >/dev/null || fail 'The downloaded application could not start.'
    as_owner mv "$stage/$directory" "$destination"
    if ! prepare "$destination"; then
      as_owner rm -rf "$destination"
      fail 'The downloaded application could not be prepared.'
    fi
  else
    "$destination/bin/ragents" --help >/dev/null || fail "The existing installation at $destination could not start."
    prepare "$destination" || fail "The existing installation at $destination could not be prepared."
  fi

  printf '#!/bin/sh\nexec '\''%s'\'' "$@"\n' "$(single_quoted "$destination/bin/ragents")" > "$download/ragents"
  as_owner cp "$download/ragents" "$stage/ragents"
  as_owner chmod 755 "$stage/ragents"
  as_owner mv -f "$stage/ragents" "$shim"
  if [ "$scope" = global ]; then audience='all users'; else audience='the current user'; fi
  printf 'Installed RAgents %s for %s in %s.\n' "$version" "$audience" "$prefix"
  if on_path; then
    printf 'Run: ragents --help\n'
  else
    path_hint
  fi
  report_others
}

install_ragents "$@"
