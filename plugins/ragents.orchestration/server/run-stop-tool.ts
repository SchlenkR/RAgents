import { Type } from "typebox";
import { defineRunFunction, defineToolAvailability, holdsUsable, type ToolContributor } from "@aicontainer/ragents";
import { toolDescriptorFrom } from "@aicontainer/server/plugin-support/agent-tool.js";

const available = defineToolAvailability({
  availability: "conditional",
  availabilityDetail: "Für den Primary-Actor mit execution.stopOwned im eigenen Run.",
  requiredCapabilities: ["execution.stopOwned"],
}, (actor, view) => actor.kind !== "human" && actor.id === view.primaryActorId && holdsUsable(actor, "execution.stopOwned"));

export const createRunStopContributor = (stop: (runId: string) => Promise<void>, onError: (error: unknown) => void): ToolContributor => {
  const definition = defineRunFunction({
    name: "run_stop",
    label: "Lauf stoppen",
    description: "Leitet den vollständigen Stopp des eigenen Runs ein: laufende Turns, Werkzeuge, Unteragenten und Plugin-Dienste. Unterhaltung und Dateien bleiben erhalten. Bricht auch den eigenen Turn ab; die Annahme ist keine Bestätigung abgeschlossener Bereinigung. Bei Benutzerwunsch nach vollständigem Abbruch sofort verwenden, keine Abbruchnachricht an beschäftigte Agenten senden.",
    schema: Type.Object({}, { additionalProperties: false }),
    resultSchema: Type.Object({ requested: Type.Literal(true) }, { additionalProperties: false }),
    available,
    run: ({ caller, signal }) => {
      signal?.throwIfAborted();
      void stop(caller.runId).catch(onError);
      return { requested: true as const };
    },
  });
  return {
    name: "ragents.orchestration.run-stop",
    descriptors: [toolDescriptorFrom(definition, available)],
    tools: () => [definition],
  };
};
