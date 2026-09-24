import { readFile } from "node:fs/promises";
import path from "node:path";

const PROJECT_LINE = /^Project\("\{[^}]+\}"\)\s*=\s*"[^"]*",\s*"([^"]+)"/gm;

export const solutionProjects = async (solutionFile: string): Promise<string[]> => {
  const text = await readFile(solutionFile, "utf8");
  const directory = path.dirname(solutionFile);
  return [...text.matchAll(PROJECT_LINE)]
    .map((match) => match[1].replaceAll("\\", "/"))
    .filter((relative) => /\.[a-z]+proj$/i.test(relative))
    .map((relative) => path.resolve(directory, relative));
};
