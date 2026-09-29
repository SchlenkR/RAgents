import type { PromptContribution } from "@ragents/engine";
import { shellPlatformText, type ShellTools } from "@ragents/workspace-executor";
import { boundToTools } from "@ragents/host/plugin-support/prompt.js";

export const shellPlatformChapter = (platform: NodeJS.Platform, tools: ShellTools): string =>
  `## Shell platform\n\n${shellPlatformText(platform, tools)}`;

/** Ohne Angabe gelten Plattform und Werkzeuge des Servers; `chapterFor` nennt die des Executors, der den Run ausführt. */
export const shellPlatformPrompt = (
  id: string,
  order: number,
  serverTools: ShellTools,
  chapterFor?: (runId: string) => string,
): PromptContribution => boundToTools({
  id,
  order,
  delivery: "initial",
  render: () => shellPlatformChapter(process.platform, serverTools),
  ...(chapterFor ? { renderForRun: chapterFor } : {}),
}, "bash");
