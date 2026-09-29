import { defineActor } from "@ragents/server";
import { Type } from "typebox";

const KEPT_NOTES = 50;

const contract = {
  state: Type.Object({ notes: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
  functions: {
    clear: { label: "Clear notes", input: Type.Object({}, { additionalProperties: false }), output: Type.Object({ cleared: Type.Integer() }, { additionalProperties: false }) },
  },
  input: { capabilities: [] },
} as const;

export default defineActor(contract, {
  functions: {
    clear: (_input, context) => {
      const cleared = context.state.read().notes?.length ?? 0;
      context.state.replace({ notes: [] });
      return { cleared };
    },
  },
  onInput: (input, context) => {
    const note = input.content.trim();
    if (!note) throw new Error("A note needs text.");
    context.state.replace({ notes: [note, ...context.state.read().notes ?? []].slice(0, KEPT_NOTES) });
  },
});
