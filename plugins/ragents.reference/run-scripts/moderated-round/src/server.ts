import { defineActor } from "@ragents/server";
import { Type } from "typebox";

const contract = {
  state: Type.Object({ built: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  functions: {},
  input: { capabilities: ["model_list", "agent_spawn", "run_configure", "actor_input"] },
} as const;

type Start = { input: { topic?: string } | null };

const guestOf = (name: string): string =>
  name === "kai" ? "Du bist Kai, pragmatisch und knapp." : "Du bist Lena, gründlich und abwägend.";

export default defineActor(contract, {
  functions: {},
  onInput: async (input, context) => {
    const state = context.state.read();
    if (state && state.built) return;
    const start = JSON.parse(input.content) as Start;
    const topic = start.input && start.input.topic ? start.input.topic : "Was macht ein gutes Team aus?";

    const catalog = await context.functions.model_list({});
    const profiles = catalog.profiles.filter((profile) => profile.driver === "agent" && profile.name !== "coordinator");
    const first = profiles[0];
    if (!first) throw new Error("Kein Agentenprofil außer dem Koordinator; agent_spawn braucht eines.");

    const moderator = await context.functions.agent_spawn({
      handle: "moderator",
      displayName: "Moderator",
      prompt: "Du moderierst eine Gesprächsrunde zwischen dem Benutzer und zwei Gästen.",
      profile: first.name,
      tools: ["actor_input", "event_subscribe", "event_unsubscribe", "event_subscription_list"],
    });
    const guests: string[] = [];
    for (const name of ["kai", "lena"]) {
      const guest = await context.functions.agent_spawn({
        handle: name,
        prompt: `${guestOf(name)} Antworte mit höchstens zwei Sätzen.`,
        profile: first.name,
        tools: [],
      });
      guests.push(`@${guest.handle}`);
    }

    await context.functions.run_configure({
      title: `Moderierte Runde: ${topic}`,
      primaryActor: `@${moderator.handle}`,
    });

    await context.functions.actor_input({
      actor: `@${moderator.handle}`,
      content: "Du bist der Moderator dieses Runs und sprichst direkt mit dem Benutzer im Chat; einen Koordinator gibt es nicht. "
        + `Deine Gäste sind ${guests.join(" und ")}. Hole ihre Beiträge ein und beziehe sie in die Gesprächsrunde ein. `
        + `Thema: "${topic}". Begrüße den Benutzer mit zwei Sätzen, nenne das Thema und frage, ob er die erste Frage stellt oder du beginnen sollst.`,
    });

    context.state.replace({ built: true });
  },
});
