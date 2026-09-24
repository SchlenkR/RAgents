import { Type } from "typebox";

export const contract = {
  state: Type.Object({
    status: Type.Optional(Type.Union([Type.Literal("setup"), Type.Literal("ready"), Type.Literal("running"), Type.Literal("completed"), Type.Literal("error")])),
    participants: Type.Optional(Type.Array(Type.Object({ id: Type.String(), handle: Type.String(), name: Type.String() }, { additionalProperties: false }))),
    entries: Type.Optional(Type.Array(Type.Object({ participant: Type.Integer({ minimum: 0, maximum: 3 }), word: Type.String() }, { additionalProperties: false }), { maxItems: 12 })),
    pendingInputId: Type.Optional(Type.String()),
    subscriptionId: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
    document: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
  functions: {
    start: {
      label: "Wortspiel starten",
      description: "Startet die zwölf Beiträge genau einmal über den Steueractor.",
      input: Type.Object({}, { additionalProperties: false }),
      output: Type.Object({ accepted: Type.Boolean() }, { additionalProperties: false }),
      capabilities: ["actor_input"],
    },
  },
  input: { capabilities: ["model_list", "agent_spawn", "canvas_layout_replace", "run_configure", "event_subscribe", "event_query", "actor_input"] },
} as const;
