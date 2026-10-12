import { Type } from "typebox";
import { defineRunFunction, defineToolAvailability, holdsUsable, type ToolContributor } from "@ragents/engine";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";

const available = defineToolAvailability({
  availability: "conditional",
  availabilityDetail: "For the primary actor with execution.stopOwned in its own run.",
  requiredCapabilities: ["execution.stopOwned"],
}, (actor, view) => actor.kind !== "human" && actor.id === view.primaryActorId && holdsUsable(actor, "execution.stopOwned"));

export const createRunStopContributor = (stop: (runId: string) => Promise<void>, onError: (error: unknown) => void): ToolContributor => {
  const definition = defineRunFunction({
    name: "run_stop",
    label: "Stop run",
    description: "Stops all work in your run: running turns, tools, starts and plugin services. Actors, conversation and files remain available. The run continues with the owner's next message. Also interrupts your own turn; acceptance confirms the request, not completed cleanup. Use immediately when the user requests a complete stop.",
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
