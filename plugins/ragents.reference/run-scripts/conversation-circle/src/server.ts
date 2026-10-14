import { defineActor } from "@ragents/server";
import { Type } from "typebox";

const contract = {
  state: Type.Object({ built: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  functions: {},
  input: { capabilities: ["model_list", "agent_spawn", "actor_input", "run_configure"] },
  parameters: Type.Object({
    topic: Type.Optional(Type.String({ minLength: 1, maxLength: 160, pattern: "\\S", description: "The question the circle discusses" })),
    rounds: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, description: "How many rounds the coordinator leads" })),
  }),
} as const;

const roleOf = (name: string): string => {
  if (name === "mira") return "You are Mira and you ask curious questions.";
  if (name === "jon") return "You are Jon and you politely disagree.";
  return "You are Ada and you look for common ground.";
};

const descriptionOf = (name: string): string => {
  if (name === "mira") return "asks curious questions";
  if (name === "jon") return "voices polite disagreement";
  return "looks for common ground";
};

/** The address of an actor of this start's room as the coordinator in the main room writes it. */
const addressIn = (room: string | null, handle: string): string => room === null ? handle : `${room}.${handle}`;

export default defineActor(contract, {
  functions: {},
  onInput: () => {},
  onStart: async (start, context) => {
    if (context.state.read().built) return;
    const topic = start.parameters.topic?.trim() ?? "Should city centers become car-free?";
    const rounds = start.parameters.rounds ?? 2;

    const catalog = await context.functions.model_list({});
    const profiles = catalog.profiles.filter((profile) => profile.driver === "agent" && profile.name !== "coordinator");
    const first = profiles[0];
    if (!first) throw new Error("No role other than coordinator; agent_spawn needs one.");

    await context.functions.run_configure({ title: `Conversation circle: ${topic}` });

    const participants: string[] = [];
    for (const name of ["mira", "jon", "ada"]) {
      const participant = await context.functions.agent_spawn({
        name,
        description: descriptionOf(name),
        instructions: `${roleOf(name)} Reply only with one short sentence as the next contribution to the conversation.`,
        profile: first.name,
        tools: [],
      });
      participants.push(`@${addressIn(start.room, participant.handle)}`);
    }

    await context.functions.actor_input({
      to: "@coordinator",
      message: `The circle is ready: ${participants.join(", ")} are set up. Topic: "${topic}". `
        + `Run exactly ${rounds} conversation rounds: in each round ${participants.join(", ")} in this order. `
        + "Each one receives the previous contributions. "
        + "At the end, summarize the conversation in three sentences.",
    });

    context.state.replace({ built: true });
  },
});
