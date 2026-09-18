import { pluginAssetPath } from "@aicontainer/server/plugin-support/asset-path.js";
import { boundToTools, handlebarsPrompt } from "@aicontainer/server/plugin-support/prompt.js";

const buildingTools = [
  "actor_program_create",
  "actor_program_activate",
  "actor_program_diagnostics",
  "actor_program_list",
  "actor_program_remove",
  "actor_view_set_visibility",
] as const;

export const actorProgramGuide = handlebarsPrompt(
  "ragents.actor-programs.prompt", 750, pluginAssetPath(import.meta.url, "../prompt.hbs"),
);

export const actorProgramSummary = boundToTools(
  { ...handlebarsPrompt("ragents.actor-programs.summary", 749, pluginAssetPath(import.meta.url, "../summary.hbs")), delivery: "initial" },
  "actor_program_controls",
  ...buildingTools,
);
