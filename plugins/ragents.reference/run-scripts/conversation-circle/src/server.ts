import { defineActor } from "@ragents/server";
import { Type } from "typebox";

const contract = {
  state: Type.Object({ built: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  functions: {},
  input: { capabilities: ["model_list", "agent_spawn", "canvas_layout_replace", "actor_input", "run_configure"] },
} as const;

type Start = { input: unknown };

const settingsFrom = (value: unknown): { topic: string; rounds: number } => {
  if (value === null) return { topic: "Sollten Innenstädte autofrei werden?", rounds: 2 };
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Startwert braucht topic (1 bis 160 Zeichen) und rounds (ganze Zahl von 1 bis 5).");
  }
  const settings = value as Record<string, unknown>;
  if (Object.keys(settings).some((key) => key !== "topic" && key !== "rounds")
    || typeof settings.topic !== "string" || !settings.topic.trim() || settings.topic.trim().length > 160
    || typeof settings.rounds !== "number" || !Number.isInteger(settings.rounds) || settings.rounds < 1 || settings.rounds > 5) {
    throw new Error("Startwert braucht topic (1 bis 160 Zeichen) und rounds (ganze Zahl von 1 bis 5).");
  }
  return { topic: settings.topic.trim(), rounds: settings.rounds };
};

const roleOf = (name: string): string => {
  if (name === "mira") return "Du bist Mira und fragst neugierig nach.";
  if (name === "jon") return "Du bist Jon und widersprichst höflich.";
  return "Du bist Ada und suchst den gemeinsamen Nenner.";
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
    if (!first) throw new Error("Kein Agentenprofil außer dem Koordinator; agent_spawn braucht eines.");

    await context.functions.run_configure({ title: `Gesprächsrunde: ${topic}` });

    const participants: string[] = [];
    for (const name of ["mira", "jon", "ada"]) {
      const participant = await context.functions.agent_spawn({
        handle: name,
        prompt: `${roleOf(name)} Antworte ausschließlich mit einem kurzen Satz als nächstem Gesprächsbeitrag.`,
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
      content: `Die Runde steht: ${participants.join(", ")} sind aufgestellt, die Fläche ist aufgeteilt. Thema: "${topic}". `
        + `Führe genau ${rounds} Gesprächsrunden durch: in jeder Runde ${participants.join(", ")} in dieser Reihenfolge. `
        + "Jeder erhält die bisherigen Beiträge. Ändere die Fläche nicht. "
        + "Fasse das Gespräch am Ende in drei Sätzen zusammen.",
    });

    context.state.replace({ built: true });
  },
});
