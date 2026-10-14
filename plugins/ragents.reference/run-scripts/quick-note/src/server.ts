import { defineActor } from "@ragents/server";
import { Type } from "typebox";

const contract = {
  state: Type.Object({}, { additionalProperties: false }),
  functions: {},
  input: { capabilities: ["actor_program_ensure", "actor_input", ] },
  parameters: Type.Object({
    text: Type.Optional(Type.String({ minLength: 1, pattern: "\\S", description: "The note; without it the note says when the script started" })),
  }),
} as const;

export default defineActor(contract, {
  functions: {},
  onInput: () => {
    throw new Error("The quick note answers only starts; start it again with the note as its text parameter.");
  },
  onStart: async (start, context) => {
    const note = start.parameters.text?.trim() ?? `Started at ${context.std.now()}.`;
    const notebook = await context.functions.actor_program_ensure({ name: "notebook" });
    await context.functions.actor_input({ to: `@${notebook.handle}`, message: note });
    context.finish({ note, notebook: notebook.status }, { summary: `Noted: ${note}` });
  },
});
