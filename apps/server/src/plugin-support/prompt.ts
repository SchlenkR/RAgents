import { readFile } from "node:fs/promises";
import Handlebars from "handlebars";
import {
  PromptContributionRegistry,
  type PromptContribution,
  type PromptRenderContext,
} from "@aicontainer/ragents";
import { selectedSystemPrompts, type SystemPromptCatalog } from "./system-prompts.js";

export const handlebarsPrompt = (
  id: string,
  order: number,
  file: string,
  values: Readonly<Record<string, unknown>> = {},
): PromptContribution => {
  let template: Promise<Handlebars.TemplateDelegate> | undefined;
  return {
    id,
    order,
    render: async (context) => {
      template ??= readFile(file, "utf8").then((source) => Handlebars.compile(source));
      return (await template)({ ...PromptContributionRegistry.handlebarsContext(context), ...values });
    },
  };
};

export const boundToTools = (
  contribution: PromptContribution,
  ...toolNames: readonly string[]
): PromptContribution => {
  if (toolNames.length === 0) {
    throw new Error(`Der Prompt-Beitrag ${contribution.id} nennt kein Werkzeug, an das er gebunden ist`);
  }
  return { ...contribution, delivery: contribution.delivery ?? "on-demand", requiresTools: toolNames };
};

const optionTemplates = new Map<string, Promise<Handlebars.TemplateDelegate>>();

const renderOption = async (file: string, context: PromptRenderContext): Promise<string> => {
  const cached = optionTemplates.get(file)
    ?? readFile(file, "utf8").then((source) => Handlebars.compile(source));
  optionTemplates.set(file, cached);
  return (await cached)(PromptContributionRegistry.handlebarsContext(context));
};

export const renderSystemPromptOption = async (
  catalog: SystemPromptCatalog,
  context: PromptRenderContext,
): Promise<string> => {
  const texts = await Promise.all(
    selectedSystemPrompts(catalog, context.systemPromptIds).map((option) => renderOption(option.file, context)));
  return texts.map((text) => text.trim()).filter(Boolean).join("\n\n");
};

export const systemPromptSelectionPromptIds = new Set<string>();

export const systemPromptSelectionPrompt = (
  id: string,
  order: number,
  catalog: SystemPromptCatalog,
): PromptContribution => {
  systemPromptSelectionPromptIds.add(id);
  return {
    id,
    order,
    render: (context) => renderSystemPromptOption(catalog, context),
  };
};
