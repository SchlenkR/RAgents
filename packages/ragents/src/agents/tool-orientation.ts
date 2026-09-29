import type { RunFunction } from "./tools.ts";

export type ToolChapters = (toolNames: readonly string[]) => string | Promise<string>;

export const toolOrientationText = (functions: readonly RunFunction[]): string => functions.length === 0 ? "" : [
    "[TypeScript functions of this actor]",
    "Call directly provided tools such as read, write, edit and bash without an extra TypeScript wrapper. Call the remaining functions through context.functions in typescript_eval.",
    "typescript_api with names returns the exact input and return types as well as detailed descriptions and instructions, with context: true once the declarations of context itself (state, log, std with mediators).",
    ...functions.filter((fn) => fn.name !== "typescript_api" && fn.name !== "typescript_eval")
        .toSorted((left, right) => left.name.localeCompare(right.name, "en"))
        .map((fn) => `- ${fn.name}${fn.nativeTool ? " (direct tool)" : ""}: ${fn.description.replace(/\s+/g, " ").trim()}`),
].join("\n");
