import type { ProductRuntimePolicy } from "@ragents/host/ragents/product-runtime.js";
import { ragentsProductConfig } from "./config.js";

const contract = [
  "General rules:",
  "- Wherever you write German (chat, commit messages, documents, comments), always use real umlauts (ä/ö/ü/Ä/Ö/Ü) and a real ß, never ae/oe/ue/ss.",
  "- Only characters of the German keyboard: as a dash always the simple hyphen -, no em or en dashes, no ellipsis characters, no typographic quotation marks. ... instead of an ellipsis, -> instead of an arrow.",
].join("\n");

const promptComposition = [
  "Run coordinator: product prompt and setup instruction, independent of the chosen primary actor.",
  "Other actors keep their own actor prompt; the primary choice only determines output and role contract.",
  "ActorInputs and the current run state are added separately as turn context.",
  "Actors with workspace tools get the workspace description as the last chapter; the agent runtime adds skills and hooks.",
].join(" ");

export const ragentsProductRuntime = {
  coordinator: {
    handle: "coordinator",
    displayName: "Coordinator",
    profile: "coordinator",
    runTitle: "New run",
    ownerHandle: "user",
    ownerDisplayName: "User",
  },
  roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker",
  contract: () => contract,
  promptComposition,
  systemPrompts: ragentsProductConfig.systemPrompts,
} satisfies ProductRuntimePolicy;
