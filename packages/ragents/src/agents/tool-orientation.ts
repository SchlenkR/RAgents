import type { RunFunction } from "./tools.ts";

export type ToolChapters = (toolNames: readonly string[]) => string | Promise<string>;

export const toolOrientationText = (functions: readonly RunFunction[]): string => functions.length === 0 ? "" : [
    "[TypeScript-Funktionen dieses Actors]",
    "Direkt bereitgestellte Werkzeuge wie read, write, edit und bash ohne zusätzliche TypeScript-Hülle aufrufen. Die übrigen Funktionen über context.functions in typescript_eval aufrufen.",
    "typescript_api mit names liefert die genauen Eingabe- und Rückgabetypen sowie ausführliche Beschreibungen und Anleitungen.",
    ...functions.filter((fn) => fn.name !== "typescript_api" && fn.name !== "typescript_eval")
        .toSorted((left, right) => left.name.localeCompare(right.name, "en"))
        .map((fn) => `- ${fn.name}${fn.nativeTool ? " (direktes Werkzeug)" : ""}: ${fn.description.replace(/\s+/g, " ").trim()}`),
].join("\n");
