const platformTexts: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "`bash` runs on macOS with the BSD userland: `grep` has no `-P` (use `grep -E` or `rg`), in-place `sed` needs an explicit backup suffix (`sed -i '' ...`), `date` uses `-v` instead of `-d`, `xargs` uses `-I{}` instead of `-i`, and other GNU-only flags are unavailable.",
  linux: "`bash` runs on Linux with the GNU userland: `grep -P`, `sed -i` without suffix and the usual GNU flags work.",
  win32: "`bash` runs on Windows through Git Bash, an MSYS userland with the GNU tools: `grep -P`, `sed -i` without suffix and the usual GNU flags work. The file system is the Windows one: absolute paths are `C:/project/...` or `/c/project/...`, both spellings reach the same file, and a path from another tool may use backslashes. Files often carry CRLF line endings, so anchor patterns with `\\r\\?$` and keep the line ending a file already has. Windows programs (`dotnet`, `git`, `node`) are on the `PATH` and take Windows paths, not `/c/...`.",
};

export const shellPlatformText = (platform: NodeJS.Platform = process.platform): string => {
  const text = platformTexts[platform];
  if (!text) throw new Error(`Für die Plattform ${platform} gibt es keine Shell-Beschreibung.`);
  return `${text} A nonzero exit code, for example \`grep\` without a match, comes back as an ordinary result with the code at the end, not as a tool error; only start, timeout and abort problems are tool errors.`;
};
