import { isNativeTool, type RunFunction } from "./tools.ts";

export type ToolChapters = (toolNames: readonly string[]) => string | Promise<string>;

export const toolOrientationText = (functions: readonly RunFunction[]): string => {
    const snippetOnly = functions
        .filter((fn) => !isNativeTool(fn))
        .toSorted((left, right) => left.name.localeCompare(right.name, "en"));
    return functions.length === 0 ? "" : [
        "[TypeScript functions of this actor]",
        "Call your tools directly. In typescript_eval every tool is also available as context.functions.<name>(input); use a snippet to combine calls or to filter results and pass them on.",
        "typescript_api with names returns the exact input and return types as well as detailed descriptions and instructions, with context: true once the declarations of context itself (state, log, std with mediators).",
        ...(snippetOnly.length === 0 ? [] : [
            "Only available through context.functions:",
            ...snippetOnly.map((fn) => `- ${fn.name}: ${fn.description.replace(/\s+/g, " ").trim()}`),
        ]),
    ].join("\n");
};
