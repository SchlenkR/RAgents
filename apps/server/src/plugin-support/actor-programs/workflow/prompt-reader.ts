import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { validatePromptReference } from "./index.js";

export function createPromptReader(directory: string): (reference: string) => Promise<string> {
  return async (reference) => {
    validatePromptReference(reference);
    const root = await realpath(directory);
    const filename = await realpath(path.join(root, reference));
    if (!filename.startsWith(`${root}${path.sep}`)) throw new Error(`Prompt file lies outside the actor package: ${reference}`);
    const content = await readFile(filename, "utf8");
    if (!content.trim()) throw new Error(`Prompt file is empty: ${reference}`);
    return content;
  };
}
