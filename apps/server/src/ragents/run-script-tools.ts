import { Type } from "typebox";
import { addressFrom, defineRunFunction, defineToolAvailability, holdsUsable, type JsonValue, type PluginHost, type ToolContributor } from "@ragents/engine";
import { toolDescriptorFrom } from "../plugin-support/agent-tool.js";
import { runManagementToken, type RunManagement } from "./global-chat.js";

const available = defineToolAvailability({
  availability: "conditional",
  availabilityDetail: "Only with the capability script.start, which the coordinator holds and passes to no agent it spawns.",
  requiredCapabilities: ["script.start"],
}, (actor) => actor.kind !== "human" && holdsUsable(actor, "script.start"));

const listMetadata = {
  name: "run_script_list",
  label: "List run scripts",
  description: "The run scripts of this profile that can join this run: entry, title, description, and whether each can start now or why not.",
} as const;

const startMetadata = {
  name: "run_script_start",
  label: "Start run script",
  description: "Start a run script from run_script_list inside this run, in a room of its own; returns its actor's address and which start of it this is.",
  longDescription: "A run script is a prepared setup of this profile: a TypeScript actor that arranges its own participants and views in this run; "
    + "for a single new LLM agent use agent_spawn instead. "
    + "entry is the entry from run_script_list; input is the script's start value, if it takes one. The script joins the run "
    + "without changing the primary actor. Every start opens a new room named after the script (name, name-2, ...) with its own actors, "
    + "so a repeated start never reuses the actors of an earlier one; handle is the setup actor's address from your room, such as name-2.name. "
    + "When it finishes a start, you receive its summary and result as a message; do not wait or poll for it in the same turn.",
} as const;

const listing = Type.Array(Type.Object({
  entry: Type.String(),
  title: Type.String(),
  description: Type.String(),
  available: Type.Boolean(),
  reason: Type.Optional(Type.String()),
}, { additionalProperties: false }));

export const createRunScriptToolContributor = (management: () => RunManagement): ToolContributor => {
  const list = defineRunFunction({
    ...listMetadata,
    schema: Type.Object({}, { additionalProperties: false }),
    resultSchema: listing,
    available,
    run: ({ caller }) => management().scripts(caller.runId).map(({ id, ...script }) => ({ entry: id, ...script })),
  });
  const start = defineRunFunction({
    ...startMetadata,
    schema: Type.Object({
      entry: Type.String({ minLength: 1, description: "The entry from run_script_list" }),
      input: Type.Optional(Type.Unknown({ description: "Start value of the script; omit it for none" })),
    }, { additionalProperties: false }),
    resultSchema: Type.Object({ handle: Type.String(), count: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
    available,
    run: async ({ caller, runtime }, _toolCallId, input) => {
      const started = await management().startScript(caller.runId, input.entry, (input.input ?? null) as JsonValue | null, caller.actorId);
      const view = runtime.view(caller.runId);
      const actor = view.actors.find((candidate) => candidate.id === started.actorId);
      const room = view.actors.find((candidate) => candidate.id === caller.actorId)?.room ?? null;
      return { handle: actor ? addressFrom(actor, room) : started.handle, count: started.count };
    },
  });
  return {
    name: "ragents.run-scripts",
    descriptors: [toolDescriptorFrom(listMetadata, available), toolDescriptorFrom(startMetadata, available)],
    tools: () => [list, start],
  };
};

/** The profile registers them once while composing; they act on the caller's own run. */
export const registerRunScriptFunctions = (host: PluginHost): void => {
  host.tools.register("ragents.runtime", [createRunScriptToolContributor(() => host.service(runManagementToken)())]);
};
