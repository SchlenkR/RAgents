import { defineActor } from "@ragents/server";
import { Type } from "typebox";

const contract = {
  state: Type.Object({ built: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  functions: {},
  input: { capabilities: ["model_list", "agent_spawn", "canvas_layout_replace", "actor_input", "run_configure"] },
} as const;

type Start = { input: unknown };

const settingsFrom = (value: unknown): { topic: string; rounds: number } => {
  if (value === null) return { topic: "Should city centers become car-free?", rounds: 2 };
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The start value needs topic (1 to 160 characters) and rounds (an integer from 1 to 5).");
  }
  const settings = value as Record<string, unknown>;
  if (Object.keys(settings).some((key) => key !== "topic" && key !== "rounds")
    || typeof settings.topic !== "string" || !settings.topic.trim() || settings.topic.trim().length > 160
    || typeof settings.rounds !== "number" || !Number.isInteger(settings.rounds) || settings.rounds < 1 || settings.rounds > 5) {
    throw new Error("The start value needs topic (1 to 160 characters) and rounds (an integer from 1 to 5).");
  }
  return { topic: settings.topic.trim(), rounds: settings.rounds };
};

const roleOf = (name: string): string => {
  if (name === "mira") return "You are Mira and you ask curious questions.";
  if (name === "jon") return "You are Jon and you politely disagree.";
  return "You are Ada and you look for common ground.";
};

export default defineActor(contract, {
  functions: {},
  onInput: async (input, context) => {
    const state = context.state.read();
    if (state && state.built) return;
    const start = JSON.parse(input.content) as Start;
    const settings = settingsFrom(start.input);
    const topic = settings.topic;
    const rounds = settings.rounds;

    const catalog = await context.functions.model_list({});
    const profiles = catalog.profiles.filter((profile) => profile.driver === "agent" && profile.name !== "coordinator");
    const first = profiles[0];
    if (!first) throw new Error("No role other than coordinator; agent_spawn needs one.");

    await context.functions.run_configure({ title: `Conversation circle: ${topic}` });

    const participants: string[] = [];
    for (const name of ["mira", "jon", "ada"]) {
      const participant = await context.functions.agent_spawn({
        handle: name,
        prompt: `${roleOf(name)} Reply only with one short sentence as the next contribution to the conversation.`,
        profile: first.name,
        tools: [],
      });
      participants.push(`@${participant.handle}`);
    }

    await context.functions.canvas_layout_replace({
      root: {
        direction: "vertical",
        weights: [1, 1],
        children: [
          { entity: participants[0]! },
          { direction: "horizontal", weights: [1, 1], children: [{ entity: participants[1]! }, { entity: participants[2]! }] },
        ],
      },
    });

    await context.functions.actor_input({
      actor: "@coordinator",
      content: `The circle is ready: ${participants.join(", ")} are set up, the surface is split. Topic: "${topic}". `
        + `Run exactly ${rounds} conversation rounds: in each round ${participants.join(", ")} in this order. `
        + "Each one receives the previous contributions. Do not change the surface. "
        + "At the end, summarize the conversation in three sentences.",
    });

    context.state.replace({ built: true });
  },
});
