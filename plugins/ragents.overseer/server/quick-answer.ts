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
  label: "Kurze Antwort",
  description: "Ergänzt nach der normalen Chatantwort eine kurze Zusammenfassung von Nutzerfrage und Ergebnis.",
  longDescription: "Nach deiner normalen Chatantwort: Wiederhole die aktuelle Nutzerfrage kurz in question und fasse dein Ergebnis in text als kurzen deutschen Satz zusammen. "
    + `Beide Texte dürfen jeweils höchstens ${QUICK_ANSWER_MAX_LENGTH} Zeichen lang sein und ersetzen die Chatantwort nicht.`,
};

const available = defineToolAvailability({
  availability: "conditional",
  availabilityDetail: "Nur für den globalen Primary-Koordinator mit plugin.state.write.",
}, (actor, view) => isCoordinatorRunId(view.id) && actor.kind === "agent"
  && actor.id === view.primaryActorId && holdsUsable(actor, "plugin.state.write"));

export const createQuickAnswerTool = (): RunFunction => defineRunFunction({
  ...metadata,
  schema: Type.Object({
    question: Type.String({ minLength: 1, maxLength: QUICK_ANSWER_MAX_LENGTH, description: "Die aktuelle Nutzerfrage kurz in eigenen Worten wiederholen." }),
    text: Type.String({ minLength: 1, maxLength: QUICK_ANSWER_MAX_LENGTH, description: "Ein kurzer Satz mit dem Ergebnis deiner normalen Chatantwort." }),
  }),
  resultSchema: Type.Object({ ok: Type.Literal(true) }),
  available,
  run: ({ runtime, caller, context }, toolCallId, input) => {
    const view = runtime.view(caller.runId);
    const actor = view.actors.find((entry) => entry.id === caller.actorId);
    if (!actor || !available(actor, view)) throw new DomainError("quick-answer-unavailable", "quick_answer steht nur dem globalen Koordinator zur Verfügung.", 403);
    for (const field of ["question", "text"] as const) {
      const value = input[field];
      if (typeof value !== "string" || !value.trim() || value.trim().length > QUICK_ANSWER_MAX_LENGTH || /[\r\n]/.test(value.trim())) {
        throw new DomainError("quick-answer-invalid", `${field} muss einen kurzen Satz ohne Zeilenumbrüche mit 1 bis ${QUICK_ANSWER_MAX_LENGTH} Zeichen enthalten.`, 400);
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
