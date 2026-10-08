import { DomainError, type ContextToolResult, type JsonValue } from "@ragents/engine";

export const COMPACTION_PLUGIN_ID = "ragents.compaction";
export const isContextTool = (name: string): boolean => ["context_list", "context_recall", "context_keep"].includes(name);

export type RetentionState = {
  budgetTokens: number;
  modelReadsImages: boolean;
  kept: string[];
};

export const retentionState = (value: JsonValue | undefined): RetentionState => {
  if (value === undefined) return { budgetTokens: 0, modelReadsImages: false, kept: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !Number.isSafeInteger(value.budgetTokens) || (value.budgetTokens as number) < 0
    || typeof value.modelReadsImages !== "boolean"
    || !Array.isArray(value.kept) || value.kept.some((entry) => typeof entry !== "string")) {
    throw new Error("The compaction retention state is invalid.");
  }
  return value as RetentionState;
};

export function resultByReference(results: readonly ContextToolResult[], reference: string): ContextToolResult {
  const result = results.find((entry) => entry.reference === reference);
  if (!result) throw new DomainError("context-result-not-found", `Unknown tool result ${reference}. Use context_list to find this actor's available references.`, 404);
  return result;
}

export const fileOf = (result: ContextToolResult): string | undefined => {
  const file = result.call?.arguments.file_path;
  return typeof file === "string" ? file : undefined;
};

export const textOf = (result: ContextToolResult): string =>
  result.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");

export function retainedResults(results: readonly ContextToolResult[], state: RetentionState, budget: number, modelReadsImages = state.modelReadsImages): ContextToolResult[] {
  const pinned = state.kept.map((reference) => resultByReference(results, reference));
  const hasImages = (result: ContextToolResult) => result.message.content.some((part) => part.type === "image");
  if (!modelReadsImages && pinned.some(hasImages)) throw new DomainError("context-retention-images", "A kept result contains images, but this model does not accept them. Release it with context_keep.", 400);
  const used = pinned.reduce((sum, result) => sum + result.tokens, 0);
  if (used > budget) throw new DomainError("context-retention-budget", `Kept tool results need ${used} tokens; this model allows ${budget}. Release results with context_keep before compacting.`, 400);
  const selected = [...pinned];
  let remaining = budget - used;
  const changed = new Set<string>();
  const excerpts = new Set<string>();
  for (const result of [...results].reverse()) {
    const file = fileOf(result);
    if (file && !result.message.isError && (result.message.toolName === "write" || result.message.toolName === "edit")) changed.add(file);
    if (selected.some((entry) => entry.entryId === result.entryId)) continue;
    if (result.message.isError || result.message.toolName !== "read") continue;
    if (!modelReadsImages && hasImages(result)) continue;
    if (file && changed.has(file)) continue;
    const key = file ? `${file}\0${result.call?.arguments.offset ?? 1}` : result.reference;
    if (excerpts.has(key)) continue;
    excerpts.add(key);
    if (result.tokens > remaining) continue;
    selected.push(result);
    remaining -= result.tokens;
  }
  return selected;
}

export function recoveryNotes(results: readonly ContextToolResult[], tokens: number, canKeep = true): string {
  const heading = "Original tool results remain available. Use context_list to search them and context_recall to restore one."
    + (canKeep ? " Use context_keep to retain or release it." : "");
  const limit = Math.max(0, tokens * 4);
  const short = "Use context_list and context_recall for original tool results.";
  if (heading.length > limit) return short.length <= limit ? short : "";
  const lines = [heading];
  for (const result of [...results].reverse().slice(0, 20)) {
    if (isContextTool(result.message.toolName)) continue;
    const line = `${result.reference}: ${result.message.toolName}${fileOf(result) ? ` ${fileOf(result)}` : ""}`;
    if (lines.join("\n").length + line.length + 1 > limit) break;
    lines.push(line);
  }
  return lines.join("\n");
}

export function recalledContent(result: ContextToolResult, offset = 0, limit = 8000): [
  { type: "text"; text: string },
  ...{ type: "image"; data: string; mimeType: string }[],
] {
  const text = textOf(result);
  if (offset > text.length) throw new DomainError("context-result-offset", `offset ${offset} exceeds the result's ${text.length} characters.`, 400);
  const end = Math.min(text.length, offset + limit);
  const continuation = end < text.length ? ` Continue with offset=${end}.` : "";
  const header = `Original ${result.reference}: ${result.message.toolName}${fileOf(result) ? ` ${fileOf(result)}` : ""}. Characters ${offset}-${end} of ${text.length}.${continuation}`;
  return [
    { type: "text" as const, text: `${header}\n\n${text.slice(offset, end)}` },
    ...(offset === 0 ? result.message.content.filter((part) => part.type === "image") : []),
  ];
}
