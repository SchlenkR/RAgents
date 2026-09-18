import type { PromptContribution } from "@aicontainer/ragents";
import { boundToTools } from "./prompt.js";

const platformTexts: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "`bash` runs on macOS with the BSD userland: `grep` has no `-P` (use `grep -E` or `rg`), in-place `sed` needs an explicit backup suffix (`sed -i '' ...`), `date` uses `-v` instead of `-d`, `xargs` uses `-I{}` instead of `-i`, and other GNU-only flags are unavailable.",
  linux: "`bash` runs on Linux with the GNU userland: `grep -P`, `sed -i` without suffix and the usual GNU flags work.",
};

export const shellPlatformText = (platform: NodeJS.Platform = process.platform): string => {
  const text = platformTexts[platform];
  if (!text) throw new Error(`Für die Plattform ${platform} gibt es keine Shell-Beschreibung.`);
  return `${text} A nonzero exit code, for example \`grep\` without a match, comes back as an ordinary result with the code at the end, not as a tool error; only start, timeout and abort problems are tool errors.`;
};

export const shellPlatformPrompt = (id: string, order: number): PromptContribution =>
  boundToTools({ id, order, delivery: "initial", render: () => `## Shell platform\n\n${shellPlatformText()}` }, "bash");
