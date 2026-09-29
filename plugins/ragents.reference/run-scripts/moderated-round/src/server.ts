import { defineActor } from "@ragents/server";
import { Type } from "typebox";

const contract = {
  state: Type.Object({ built: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  functions: {},
  input: { capabilities: ["model_list", "agent_spawn", "run_configure", "actor_input"] },
} as const;

type Start = { input: { topic?: string } | null };

const guestOf = (name: string): string =>
  name === "kai" ? "You are Kai, pragmatic and brief." : "You are Lena, thorough and deliberate.";

export default defineActor(contract, {
  functions: {},
  onInput: async (input, context) => {
    const state = context.state.read();
    if (state && state.built) return;
    const start = JSON.parse(input.content) as Start;
    const topic = start.input && start.input.topic ? start.input.topic : "What makes a good team?";

    const catalog = await context.functions.model_list({});
    const profiles = catalog.profiles.filter((profile) => profile.driver === "agent" && profile.name !== "coordinator");
    const first = profiles[0];
    if (!first) throw new Error("No role other than coordinator; agent_spawn needs one.");

    const moderator = await context.functions.agent_spawn({
      handle: "moderator",
      displayName: "Moderator",
      prompt: "You moderate a conversation circle between the user and two guests.",
      profile: first.name,
      tools: ["actor_input", "event_subscribe", "event_unsubscribe", "event_subscription_list"],
    });
    const guests: string[] = [];
    for (const name of ["kai", "lena"]) {
      const guest = await context.functions.agent_spawn({
        handle: name,
        prompt: `${guestOf(name)} Reply with at most two sentences.`,
        profile: first.name,
        tools: [],
      });
      guests.push(`@${guest.handle}`);
    }

    await context.functions.run_configure({
      title: `Moderated round: ${topic}`,
      primaryActor: `@${moderator.handle}`,
    });

    await context.functions.actor_input({
      actor: `@${moderator.handle}`,
      content: "You are the moderator of this run and talk directly with the user in the chat; there is no coordinator. "
        + `Your guests are ${guests.join(" and ")}. Gather their contributions and include them in the conversation circle. `
        + `Topic: "${topic}". Greet the user with two sentences, name the topic, and ask whether they want to ask the first question or whether you should begin.`,
    });

    context.state.replace({ built: true });
  },
});
