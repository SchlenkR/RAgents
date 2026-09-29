import { Type } from "typebox";
import {
  defineRunFunction, defineToolAvailability, DomainError, holdsUsable,
  type RunFunction, type ToolContributor,
} from "@ragents/engine";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import { OVERSEER_PLUGIN_ID, QUICK_ANSWER_MAX_LENGTH } from "../contract.js";
import { isCoordinatorRunId } from "./coordinator.js";

const metadata = {
  name: "quick_answer",
  label: "Quick answer",
  description: "Adds a short summary of user question and result after the normal chat answer.",
  longDescription: "After your normal chat answer: repeat the current user question briefly in question and summarize your result in text as a short sentence. "
    + `Both texts may each be at most ${QUICK_ANSWER_MAX_LENGTH} characters long and do not replace the chat answer.`,
};

const available = defineToolAvailability({
  availability: "conditional",
  availabilityDetail: "Only for the global primary coordinator with plugin.state.write.",
}, (actor, view) => isCoordinatorRunId(view.id) && actor.kind === "agent"
  && actor.id === view.primaryActorId && holdsUsable(actor, "plugin.state.write"));

export const createQuickAnswerTool = (): RunFunction => defineRunFunction({
  ...metadata,
  schema: Type.Object({
    question: Type.String({ minLength: 1, maxLength: QUICK_ANSWER_MAX_LENGTH, description: "Repeat the current user question briefly in your own words." }),
    text: Type.String({ minLength: 1, maxLength: QUICK_ANSWER_MAX_LENGTH, description: "A short sentence with the result of your normal chat answer." }),
  }),
  resultSchema: Type.Object({ ok: Type.Literal(true) }),
  available,
  run: ({ runtime, caller, context }, toolCallId, input) => {
    const view = runtime.view(caller.runId);
    const actor = view.actors.find((entry) => entry.id === caller.actorId);
    if (!actor || !available(actor, view)) throw new DomainError("quick-answer-unavailable", "quick_answer is only available to the global coordinator.", 403);
    for (const field of ["question", "text"] as const) {
      const value = input[field];
      if (typeof value !== "string" || !value.trim() || value.trim().length > QUICK_ANSWER_MAX_LENGTH || /[\r\n]/.test(value.trim())) {
        throw new DomainError("quick-answer-invalid", `${field} must contain a short sentence without line breaks with 1 to ${QUICK_ANSWER_MAX_LENGTH} characters.`, 400);
      }
    }
    runtime.replacePluginState(context(toolCallId), caller.runId, {
      pluginId: OVERSEER_PLUGIN_ID,
      scope: { kind: "run" },
      state: { kind: "quick-answer", question: input.question.trim(), text: input.text.trim() },
    });
    return { ok: true as const };
  },
});

export const createQuickAnswerContributor = (): ToolContributor => ({
  name: OVERSEER_PLUGIN_ID,
  descriptors: [toolDescriptorFrom(metadata, available)],
  tools: () => [createQuickAnswerTool()],
});
