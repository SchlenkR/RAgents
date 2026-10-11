import { readFile } from "node:fs/promises";
import Handlebars from "handlebars";
import type { PromptContribution, PromptRenderContext } from "@ragents/engine";
import { selectedSystemPrompts, type SystemPromptCatalog } from "./system-prompts.js";

/** `{{#if (available "name" ...)}}` holds when the reading actor has every named function. */
const renderOptions = (context: PromptRenderContext): Handlebars.RuntimeOptions => ({
  helpers: {
    available: (...args: unknown[]) => {
      const names = args.slice(0, -1);
      if (names.length === 0 || !names.every((name): name is string => typeof name === "string" && name.length > 0)) {
        throw new Error("The prompt helper available takes one or more function names");
      }
      const functions = context.functions;
      if (functions === undefined) throw new Error("The prompt helper available requires the reader's functions or an explicit all catalog");
      return functions === "all" || names.every((name) => functions.includes(name));
    },
  },
});

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
      return (await template)({ ...values }, renderOptions(context));
    },
  };
};

export const boundToTools = (
  contribution: PromptContribution,
  ...toolNames: readonly string[]
): PromptContribution => {
  if (toolNames.length === 0) {
    throw new Error(`The prompt contribution ${contribution.id} names no tool it is bound to`);
  }
  return { ...contribution, delivery: contribution.delivery ?? "on-demand", requiresTools: toolNames };
};

const optionTemplates = new Map<string, Promise<Handlebars.TemplateDelegate>>();

const renderOption = async (file: string, context: PromptRenderContext): Promise<string> => {
  const cached = optionTemplates.get(file)
    ?? readFile(file, "utf8").then((source) => Handlebars.compile(source));
  optionTemplates.set(file, cached);
  return (await cached)({}, renderOptions(context));
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
