import { Type } from "typebox";
import { defineRunFunction, defineToolAvailability, type ToolContributor } from "@ragents/engine";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import { readClientUiComponentNames, readClientUiComponentContracts } from "@ragents/host/plugin-support/actor-programs/client-contracts.js";
import { actorProgramGuide } from "./prompts.js";

const available = defineToolAvailability({ availability: "always", availabilityDetail: "Typisierte UI-Referenz der installierten Actor-Programm-Extension." }, () => true);
const metadata = {
  name: "actor_program_controls",
  label: "Actor-Programm-Anleitung und Controls nachschlagen",
  description: "Read Mini-App control contracts or the actor-program authoring guide.",
  longDescription: "With topic: guide, explain the TypeScript package workflow through actor_program_activate. Otherwise list control names, or select one component (for example Form) for its TypeScript props and supporting types. Import controls from @ragents/client/ui and use these exact props.",
};

export const describeClientControls = (component?: string) => {
  const components = readClientUiComponentNames();
  if (component === undefined) return { components };
  if (!components.includes(component)) throw new Error(`Unbekanntes Control ${component}. Gültig: ${components.join(", ")}`);
  return { components, component, files: readClientUiComponentContracts(component) };
};

export const createControlsToolContributor = (): ToolContributor => ({
  name: "ragents.actor-programs.controls",
  descriptors: [toolDescriptorFrom(metadata, available)],
  tools: () => [defineRunFunction({
    ...metadata,
    available,
    schema: Type.Object({
      topic: Type.Optional(Type.Union([Type.Literal("controls"), Type.Literal("guide")], { description: "Default controls: query component names or types. Guide: read the short package workflow without component." })),
      component: Type.Optional(Type.String({ minLength: 1, description: "Optional control name from the catalog, without UI. prefix. Only valid when topic is controls or omitted." })),
    }, { additionalProperties: false }),
    resultSchema: Type.Union([
      Type.Object({ guide: Type.String() }, { additionalProperties: false }),
      Type.Object({
        components: Type.Array(Type.String()),
        component: Type.Optional(Type.String()),
        files: Type.Optional(Type.Record(Type.String(), Type.String())),
      }, { additionalProperties: false }),
    ]),
    run: async (_scope, _call, input) => {
      if (input.topic === "guide") {
        if (input.component !== undefined) throw new Error("component ist nur bei topic: controls oder ohne topic erlaubt; für topic: guide lasse component weg.");
        return { guide: await actorProgramGuide.render({}) };
      }
      return describeClientControls(input.component);
    },
  })],
});
