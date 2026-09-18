import type { ProductRuntimePolicy } from "@aicontainer/server/ragents/product-runtime.js";
import { ragentsProductConfig } from "./config.js";

const contract = [
  "Allgemeine Regeln:",
  "- Wo du Deutsch schreibst (Chat, Commit-Messages, Dokumente, Kommentare), gilt immer: echte Umlaute (ä/ö/ü/Ä/Ö/Ü) und echtes ß, niemals ae/oe/ue/ss.",
  "- Nur Zeichen der deutschen Tastatur: als Strich immer der einfache Bindestrich -, keine Gedankenstriche, keine Ellipsen-Zeichen, keine typografischen Anführungszeichen. ... statt Ellipse, -> statt Pfeil.",
].join("\n");

const promptComposition = [
  "Run-Koordinator: Produktprompt und Aufbauanweisung, unabhängig vom gewählten Primary-Actor.",
  "Weitere Actors behalten ihren eigenen Actor-Prompt; die Primary-Auswahl bestimmt nur Ausgabe und Rollenvertrag.",
  "ActorInputs und aktueller Run-Zustand kommen getrennt als Turn-Kontext hinzu.",
  "Die Agentenlaufzeit ergänzt den Prompt zur Laufzeit um Working Directory, Skills und Extension-Beiträge.",
].join(" ");

export const ragentsProductRuntime = {
  coordinator: {
    handle: "coordinator",
    displayName: "Koordinator",
    profile: "coordinator",
    runTitle: "Neuer Run",
    ownerHandle: "user",
    ownerDisplayName: "Benutzer",
  },
  roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker",
  contract: () => contract,
  promptComposition,
  systemPrompts: ragentsProductConfig.systemPrompts,
} satisfies ProductRuntimePolicy;
