import { defineActor } from "@ragents/server";
import { Type } from "typebox";

const contract = {
  state: Type.Object({ built: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  functions: {},
  input: { capabilities: ["model_list", "agent_spawn", "actor_program_activate", "actor_input", "run_configure"] },
} as const;

type Start = { input: unknown };

const settingsFrom = (value: unknown): { title: string; firstEntry: string } => {
  if (value === null) return { title: "Gemeinsame Liste", firstEntry: "Hallo aus dem Run-Script" };
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Startwert braucht title (1 bis 160 Zeichen) und firstEntry (1 bis 2000 Zeichen).");
  }
  const settings = value as Record<string, unknown>;
  if (Object.keys(settings).some((key) => key !== "title" && key !== "firstEntry")
    || typeof settings.title !== "string" || !settings.title.trim() || settings.title.trim().length > 160
    || typeof settings.firstEntry !== "string" || !settings.firstEntry.trim() || settings.firstEntry.trim().length > 2000) {
    throw new Error("Startwert braucht title (1 bis 160 Zeichen) und firstEntry (1 bis 2000 Zeichen).");
  }
  return { title: settings.title.trim(), firstEntry: settings.firstEntry.trim() };
};

export default defineActor(contract, {
  functions: {},
  onInput: async (input, context) => {
    const state = context.state.read();
    if (state && state.built) return;
    const start = JSON.parse(input.content) as Start;
    const settings = settingsFrom(start.input);
    const title = settings.title;
    const firstEntry = settings.firstEntry;

    const catalog = await context.functions.model_list({});
    const profiles = catalog.profiles.filter((profile) => profile.driver === "agent" && profile.name !== "coordinator");
    const first = profiles[0];
    if (!first) throw new Error("Keine Rolle außer coordinator; agent_spawn braucht eine.");

    await context.functions.run_configure({ title: `Sammelboard: ${title}` });

    const helper = await context.functions.agent_spawn({
      handle: "listenhelfer",
      prompt: `Du führst die gemeinsame Sammlung "${title}". Jeden Eintrag, den man dir gibt, hängst du mit deiner Funktion append_to_list an und meldest den neuen Stand.`,
      profile: first.name,
      tools: null,
    });

    await context.functions.actor_program_activate({ name: "shared-list", actor: `@${helper.handle}` });

    await context.functions.actor_input({
      actor: `@${helper.handle}`,
      content: `Trage mit deiner Funktion append_to_list den Eintrag ${JSON.stringify(firstEntry)} in die gemeinsame Sammlung ${JSON.stringify(title)} ein und melde den Stand der Liste.`,
    });
    await context.functions.actor_input({
      actor: "@coordinator",
      content: `Die gemeinsame Sammlung heißt ${JSON.stringify(title)}. Das Run-Script hat das Programm shared-list an @${helper.handle} gebunden. Seine View ist auf der Fläche sichtbar; der Helfer ergänzt gerade den ersten Eintrag mit append_to_list. `
        + "Unten unter Actors öffnet sein Name den Inspector mit Chat und Details. Seine Kachel ist standardmäßig ausgeblendet und lässt sich in der Actors-Liste bei Bedarf einschalten. "
        + "Erkläre dem Benutzer in drei Sätzen, wie er die sichtbare Liste bedient, den Helfer öffnet und dass View und Funktion denselben Listenstand teilen.",
    });

    context.state.replace({ built: true });
  },
});
