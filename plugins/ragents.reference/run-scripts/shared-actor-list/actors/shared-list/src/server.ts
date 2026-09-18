import { defineActor } from "@ragents/server";
import { contract } from "./contract.ts";

export default defineActor(contract, {
  functions: {
    append: async (input, context) => {
      const text = input.text.trim();
      const state = context.state.read();
      const entries = [...(state.entries ?? []), text];
      context.state.replace({ entries });
      return { text, entries };
    },
  },
});
