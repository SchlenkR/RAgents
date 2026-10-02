import { defineActor } from "@ragents/server";
import { Type } from "typebox";

const contract = {
  state: Type.Object({ reports: Type.Optional(Type.Number()) }, { additionalProperties: false }),
  functions: {},
  input: { capabilities: ["actor_list", "actor_program_ensure", "actor_input", ] },
} as const;

export default defineActor(contract, {
  functions: {},
  onInput: () => {
    throw new Error("The roster answers only starts; start it again from the run menu or with run_script_start.");
  },
  onStart: async (_start, context) => {
    const actors = await context.functions.actor_list({});
    const others = actors.filter((actor) => actor.kind !== "human" && actor.handle !== context.actor.handle);
    const handles = others.map((actor) => `@${actor.handle}`);
    const summary = handles.length === 0 ? "No other participants yet." : `${handles.length} participant${handles.length === 1 ? "" : "s"}: ${handles.join(", ")}.`;
    const notebook = await context.functions.actor_program_ensure({ name: "notebook" });
    await context.functions.actor_input({ to: `@${notebook.handle}`, message: `Roster: ${summary}` });
    context.state.replace({ reports: (context.state.read().reports ?? 0) + 1 });
    context.finish({ actors: others.map(({ handle, kind, lifecycle }) => ({ handle, kind, lifecycle })) }, { summary });
  },
});
