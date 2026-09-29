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
    description: "Initiates the complete stop of your own run: running turns, tools, subagents and plugin services. Conversation and files are kept. Also cancels your own turn; acceptance is not a confirmation of completed cleanup. Use immediately when the user wants a complete cancellation; do not send a cancel message to busy agents.",
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
