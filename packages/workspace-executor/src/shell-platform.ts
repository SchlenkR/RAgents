const platformTexts: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "`bash` runs on macOS with the BSD userland: `grep` has no `-P` (use `grep -E`), in-place `sed` needs an explicit backup suffix (`sed -i '' ...`), `date` uses `-v` instead of `-d`, `xargs` uses `-I{}` instead of `-i`, and other GNU-only flags are unavailable. `/bin/bash` is version 3.2: no associative arrays (`declare -A`), no `mapfile`/`readarray`, no `${var,,}` case conversion.",
  linux: "`bash` runs on Linux with the GNU userland: `grep -P`, `sed -i` without suffix and the usual GNU flags work.",
  win32: "`bash` runs on Windows with the bash RAgents brings along, an MSYS userland with the GNU tools (coreutils, `grep`, `sed`, `awk`, `find`, `xargs`, `diff`, `patch`, `tar`, `gzip`, `unzip`, `file`, `cygpath`, `dos2unix`): `grep -P`, `sed -i` without suffix and the usual GNU flags work. `git`, `dotnet` and `node` are the Windows programs of this machine on the `PATH`, with the user's own configuration and login; they take Windows paths, not `/c/...` (`cygpath -w` converts). The file system is the Windows one: absolute paths are `C:/project/...` or `/c/project/...`, both spellings reach the same file, and a path from another tool may use backslashes. Files often carry CRLF line endings, so anchor patterns with `\\r\\?$` and keep the line ending a file already has.",
};

const searchTexts = {
  ripgrep: "Search code with `rg` (ripgrep) and list files with `rg --files`: it skips hidden files and everything `.gitignore` excludes, such as `node_modules`, `bin` and `obj`, and is far faster than `grep -r` (`rg -uu` searches those too). Use `grep` only on single files or in pipes.",
  grep: "`rg` (ripgrep) is not available here. `grep -r` also walks dependency and build folders, so exclude them: `grep -r --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=bin --exclude-dir=obj ...`.",
};

/** Was der Executor dem Werkzeug bash über die Plattform hinaus bietet. */
export interface ShellTools {
  readonly ripgrep: boolean;
}

export const shellPlatformText = (platform: NodeJS.Platform, tools: ShellTools): string => {
  const text = platformTexts[platform];
  if (!text) throw new Error(`Für die Plattform ${platform} gibt es keine Shell-Beschreibung.`);
  const search = tools.ripgrep ? searchTexts.ripgrep : searchTexts.grep;
  return `${text} ${search} A nonzero exit code, for example \`grep\` without a match, comes back as an ordinary result with the code at the end, not as a tool error; only start, timeout and abort problems are tool errors.`;
};
