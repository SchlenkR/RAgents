import { Type } from "typebox";
import { defineRunFunction, defineToolAvailability, type ToolContributor } from "@ragents/engine";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import { readClientUiComponentNames, readClientUiComponentContracts } from "@ragents/host/plugin-support/actor-programs/client-contracts.js";
import { actorProgramGuide, stateAwareProgramGuide } from "./prompts.js";

const available = defineToolAvailability({ availability: "always", availabilityDetail: "Typed UI reference of the installed actor program plugin." }, () => true);
const metadata = {
  name: "actor_program_controls",
  label: "Look up actor program guide and controls",
  description: "Read Mini-App control contracts or the actor-program authoring guide.",
  longDescription: "With topic: guide, explain the TypeScript package workflow through actor_program_activate; with topic: state-aware, explain defineProgram for work that waits for a time, a message or a file. Otherwise list control names, or select one component (for example Form) for only its TypeScript props and supporting types. Import controls from @ragents/client/ui and use these exact props.",
};

export const describeClientControls = (component?: string) => {
  const components = readClientUiComponentNames();
  if (component === undefined) return { components };
  if (!components.includes(component)) throw new Error(`Unknown control ${component}. Valid: ${components.join(", ")}`);
  return { files: readClientUiComponentContracts(component) };
};

export const createControlsToolContributor = (): ToolContributor => ({
  name: "ragents.actor-programs.controls",
  descriptors: [toolDescriptorFrom(metadata, available)],
  tools: () => [defineRunFunction({
    ...metadata,
    available,
    schema: Type.Object({
      topic: Type.Optional(Type.Union([Type.Literal("controls"), Type.Literal("guide"), Type.Literal("state-aware")], { description: "Default controls: query component names or types. Guide: read the short package workflow without component. State-aware: read how a defineProgram waits and continues, with its guards and an example." })),
      component: Type.Optional(Type.String({ minLength: 1, description: "Optional control name from the catalog, without UI. prefix. Only valid when topic is controls or omitted." })),
    }, { additionalProperties: false }),
    resultSchema: Type.Union([
      Type.Object({ guide: Type.String() }, { additionalProperties: false }),
      Type.Object({ components: Type.Array(Type.String()) }, { additionalProperties: false }),
      Type.Object({ files: Type.Record(Type.String(), Type.String()) }, { additionalProperties: false }),
    ]),
    run: async (scope, _call, input) => {
      if (input.topic === "guide" || input.topic === "state-aware") {
        if (input.component !== undefined) throw new Error(`component is only allowed with topic: controls or without topic; for topic: ${input.topic}, omit component.`);
        const functions = scope.availableFunctions().map((fn) => fn.name);
        return { guide: await (input.topic === "guide" ? actorProgramGuide : stateAwareProgramGuide).render({ functions }) };
      }
      return describeClientControls(input.component);
    },
  })],
});
