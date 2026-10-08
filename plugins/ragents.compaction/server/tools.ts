import { Type } from "typebox";
import { contextToolResults, defineRunFunction, defineToolAvailability, holdsUsable, type ToolScope } from "@ragents/engine";
import { COMPACTION_PLUGIN_ID, fileOf, isContextTool, recalledContent, resultByReference, retainedResults, retentionState, textOf, type RetentionState } from "./context.js";

const available = defineToolAvailability({
  availability: "conditional",
  availabilityDetail: "Only for an LLM actor's own model context, including its inherited context.",
}, (actor) => actor.kind === "agent" && actor.execution.driver.kind === "agent");

const canKeep = defineToolAvailability({
  availability: "conditional",
  availabilityDetail: "Only for LLM actors with plugin.state.write, for their own model context.",
  requiredCapabilities: ["plugin.state.write"],
}, (actor, view) => available(actor, view) && holdsUsable(actor, "plugin.state.write"));

const reference = Type.String({ minLength: 1, description: "A short tool-result reference from context_list or the compaction checkpoint, such as result-3" });

const stateOf = ({ runtime, caller }: ToolScope): RetentionState => retentionState(runtime.view(caller.runId).pluginStates
  .find((entry) => entry.pluginId === COMPACTION_PLUGIN_ID && entry.scope.kind === "actor" && entry.scope.actorId === caller.actorId)?.state);

const store = ({ runtime, caller, context }: ToolScope, callId: string, state: RetentionState): void => {
  runtime.replacePluginState(context(callId), caller.runId, {
    pluginId: COMPACTION_PLUGIN_ID,
    scope: { kind: "actor", actorId: caller.actorId },
    state,
  });
};

export const createContextTools = () => [
  defineRunFunction({
    name: "context_list",
    label: "Find Earlier Tool Results",
    description: "Find original tool results in your own conversation, including results removed from active context by compaction.",
    schema: Type.Object({
      query: Type.Optional(Type.String({ description: "Search tool names, file paths, and full original result text" })),
      before: Type.Optional(Type.String({ description: "The next reference from a previous page; list results older than this one" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "At most this many results, newest first; defaults to 20" })),
    }, { additionalProperties: false }),
    resultSchema: Type.Object({
      results: Type.Array(Type.Object({
        reference: Type.String(),
        tool: Type.String(),
        file: Type.Optional(Type.String()),
        preview: Type.String(),
        kept: Type.Boolean(),
        isError: Type.Boolean(),
      }, { additionalProperties: false })),
      next: Type.Optional(Type.String()),
    }, { additionalProperties: false }),
    available,
    run: (scope, _callId, input) => {
      const results = contextToolResults(scope.runtime.modelContext(scope.caller.runId, scope.caller.actorId).entries);
      const state = stateOf(scope);
      const before = input.before ? results.indexOf(resultByReference(results, input.before)) : results.length;
      const query = input.query?.toLowerCase();
      const matching = results.slice(0, before).reverse().filter((result) => !isContextTool(result.message.toolName) && (!query
        || `${result.message.toolName}\n${fileOf(result) ?? ""}\n${textOf(result)}`.toLowerCase().includes(query)));
      const page = matching.slice(0, input.limit ?? 20);
      return {
        results: page.map((result) => ({
          reference: result.reference,
          tool: result.message.toolName,
          ...(fileOf(result) ? { file: fileOf(result)! } : {}),
          preview: textOf(result).replace(/\s+/g, " ").slice(0, 160),
          kept: state.kept.includes(result.reference),
          isError: result.message.isError,
        })),
        ...(matching.length > page.length ? { next: page.at(-1)!.reference } : {}),
      };
    },
  }),
  defineRunFunction({
    name: "context_recall",
    label: "Restore Earlier Tool Result",
    description: "Read an original tool result by reference. Restore exact text after compaction; native calls also restore its images.",
    longDescription: "Use context_list to find references. Text is paged by zero-based character offset; a continuation names the next offset. "
      + "This restores a historical result, not the current contents of a file. Read the file again when its current version matters. "
      + "Use context_keep to preserve an important result through future compactions. TypeScript callers receive the text only.",
    schema: Type.Object({
      reference,
      offset: Type.Optional(Type.Integer({ minimum: 0, description: "Character offset in the original text, zero-based; defaults to 0" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 16000, description: "At most this many text characters; defaults to 8000" })),
    }, { additionalProperties: false }),
    resultSchema: Type.String(),
    available,
    run: (scope, _callId, input) => {
      const results = contextToolResults(scope.runtime.modelContext(scope.caller.runId, scope.caller.actorId).entries);
      const result = resultByReference(results, input.reference);
      const content = recalledContent(result, input.offset, input.limit);
      return content[0].text;
    },
  }),
  defineRunFunction({
    name: "context_keep",
    label: "Keep Tool Results in Context",
    description: "Keep important original tool results verbatim through future compactions, or release previously kept results. The retained working set is bounded.",
    schema: Type.Object({
      references: Type.Array(reference, { minItems: 1, maxItems: 50, uniqueItems: true }),
      keep: Type.Optional(Type.Boolean({ description: "true keeps these results, false releases them; defaults to true" })),
    }, { additionalProperties: false }),
    resultSchema: Type.Object({ keptCount: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
    available: canKeep,
    run: (scope, callId, input) => {
      const results = contextToolResults(scope.runtime.modelContext(scope.caller.runId, scope.caller.actorId).entries);
      for (const item of input.references) resultByReference(results, item);
      const state = stateOf(scope);
      const kept = input.keep === false ? state.kept.filter((entry) => !input.references.includes(entry)) : [...new Set([...state.kept, ...input.references])];
      const next = { ...state, kept };
      retainedResults(results, next, state.budgetTokens);
      store(scope, callId, next);
      return { keptCount: kept.length };
    },
  }),
];
