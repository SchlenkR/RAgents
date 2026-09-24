import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";
import { boundToTools, handlebarsPrompt } from "@ragents/host/plugin-support/prompt.js";

const buildingTools = [
  "actor_program_create",
  "actor_program_activate",
  "actor_program_diagnostics",
  "actor_program_list",
  "actor_program_remove",
  "actor_view_set_visibility",
] as const;

export const actorProgramGuide = handlebarsPrompt(
  "ragents.actor-programs.prompt", 750, pluginAsset("ragents.actor-programs", "prompt.hbs"),
);

export const actorProgramSummary = boundToTools(
  { ...handlebarsPrompt("ragents.actor-programs.summary", 749, pluginAsset("ragents.actor-programs", "summary.hbs")), delivery: "initial" },
  "actor_program_controls",
  ...buildingTools,
);
