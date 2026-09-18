import { Type } from "typebox";
import { defineActor } from "@ragents/server";
export default defineActor({state: Type.Object({started: Type.Optional(Type.Boolean())}), functions: {}, input: {capabilities: []}}, {
  functions: {}, onInput(_input, context) { context.state.replace({started: true}); },
});
