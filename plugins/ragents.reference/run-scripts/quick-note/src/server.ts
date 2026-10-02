import { defineActor } from "@ragents/server";
import { Type } from "typebox";

const contract = {
  state: Type.Object({}, { additionalProperties: false }),
  functions: {},
  input: { capabilities: ["actor_program_ensure", "actor_input", ] },
} as const;

const noteOf = (input: unknown, now: string): string => {
  if (input === null) return `Started at ${now}.`;
  const text = typeof input === "object" && input !== null && "text" in input ? (input as { text: unknown }).text : undefined;
  if (typeof text !== "string" || !text.trim()) throw new Error('The start value is { "text": "..." } with the note, or none.');
  return text.trim();
};

export default defineActor(contract, {
  functions: {},
  onInput: () => {
    throw new Error("The quick note answers only starts; start it again with the note as its start value.");
  },
  onStart: async (start, context) => {
    const note = noteOf(start.input, context.std.now());
    const notebook = await context.functions.actor_program_ensure({ name: "notebook" });
    await context.functions.actor_input({ to: `@${notebook.handle}`, message: note });
    context.finish({ note, notebook: notebook.status }, { summary: `Noted: ${note}` });
  },
});
