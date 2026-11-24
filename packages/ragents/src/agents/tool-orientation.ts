import { isNativeTool, type RunFunction } from "./tools.ts";

export type ToolChapters = (toolNames: readonly string[]) => string | Promise<string>;

export const toolOrientationText = (functions: readonly RunFunction[]): string => {
    const evaluate = functions.some((fn) => fn.name === "typescript_eval");
    const discover = functions.some((fn) => fn.name === "typescript_api");
    if (!evaluate && !discover) return "";
    const snippetOnly = evaluate ? functions
        .filter((fn) => !isNativeTool(fn))
        .toSorted((left, right) => left.name.localeCompare(right.name, "en")) : [];
    return [
        "[TypeScript functions of this actor]",
        "Call your tools directly.",
        evaluate ? "In typescript_eval every tool is also available as context.functions.<name>(input); use a snippet to combine calls or to filter results and pass them on." : "",
        discover ? "typescript_api with names returns the exact input and return types as well as detailed descriptions and instructions, with context: true once the declarations of context itself (state, log, std with mediators)." : "",
        ...(snippetOnly.length === 0 ? [] : [
            "Only available through context.functions:",
            ...snippetOnly.map((fn) => `- ${fn.name}: ${fn.description.replace(/\s+/g, " ").trim()}`),
        ]),
    ].filter(Boolean).join("\n");
};
