import type { PromptContribution } from "@ragents/engine";
import { shellPlatformText } from "@ragents/workspace-executor";
import { boundToTools } from "@ragents/host/plugin-support/prompt.js";

export const shellPlatformChapter = (platform: NodeJS.Platform): string =>
  `## Shell platform\n\n${shellPlatformText(platform)}`;

/** Ohne Angabe gilt die Plattform des Servers; `chapterFor` nennt die des Executors, der den Run ausführt. */
export const shellPlatformPrompt = (
  id: string,
  order: number,
  chapterFor?: (runId: string) => string,
): PromptContribution => boundToTools({
  id,
  order,
  delivery: "initial",
  render: () => shellPlatformChapter(process.platform),
  ...(chapterFor ? { renderForRun: chapterFor } : {}),
}, "bash");
