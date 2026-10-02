import { defineActor } from "@ragents/server";
import { Type } from "typebox";

const contract = {
  state: Type.Object({ built: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  functions: {},
  input: { capabilities: ["model_list", "agent_spawn", "actor_program_activate", "actor_input", "run_configure"] },
} as const;

type Start = { input: unknown };

const settingsFrom = (value: unknown): { title: string; firstEntry: string } => {
  if (value === null) return { title: "Shared list", firstEntry: "Hello from the run script" };
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The start value needs title (1 to 160 characters) and firstEntry (1 to 2000 characters).");
  }
  const settings = value as Record<string, unknown>;
  if (Object.keys(settings).some((key) => key !== "title" && key !== "firstEntry")
    || typeof settings.title !== "string" || !settings.title.trim() || settings.title.trim().length > 160
    || typeof settings.firstEntry !== "string" || !settings.firstEntry.trim() || settings.firstEntry.trim().length > 2000) {
    throw new Error("The start value needs title (1 to 160 characters) and firstEntry (1 to 2000 characters).");
  }
  return { title: settings.title.trim(), firstEntry: settings.firstEntry.trim() };
};

export default defineActor(contract, {
  functions: {},
  onInput: async (input, context) => {
    const state = context.state.read();
    if (state && state.built) return;
    const start = JSON.parse(input.content) as Start;
    const settings = settingsFrom(start.input);
    const title = settings.title;
    const firstEntry = settings.firstEntry;

    const catalog = await context.functions.model_list({});
    const profiles = catalog.profiles.filter((profile) => profile.driver === "agent" && profile.name !== "coordinator");
    const first = profiles[0];
    if (!first) throw new Error("No role other than coordinator; agent_spawn needs one.");

    await context.functions.run_configure({ title: `Collection board: ${title}` });

    const helper = await context.functions.agent_spawn({
      name: "list-helper",
      description: "keeps the shared collection",
      instructions: `You keep the shared collection "${title}". You append every entry you are given with your function append_to_list and report the new state.`,
      profile: first.name,
      tools: null,
    });

    await context.functions.actor_program_activate({ name: "shared-list", actor: `@${helper.handle}` });

    await context.functions.actor_input({
      to: `@${helper.handle}`,
      message: `Use your function append_to_list to add the entry ${JSON.stringify(firstEntry)} to the shared collection ${JSON.stringify(title)} and report the state of the list.`,
    });
    await context.functions.actor_input({
      to: "@coordinator",
      message: `The shared collection is called ${JSON.stringify(title)}. The run script has bound the program shared-list to @${helper.handle}. Its view is visible on the surface; the helper is currently adding the first entry with append_to_list. `
        + "Use the addressee selector to inspect its owner with chat and details. Open the mini-app from the app catalog. "
        + "Explain to the user in three sentences how to use the visible list, how to open the helper, and that the view and the function share the same list state.",
    });

    context.state.replace({ built: true });
  },
});
