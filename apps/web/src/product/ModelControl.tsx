import { useMemo } from "react";
import { thinkingLabel } from "../lib/labels";
import { ModelPickers } from "./ModelPickers";
import type { StartOptionControlContext } from "../PluginRegistry";

interface ModelPresentation {
  provider: string;
  options: readonly string[];
  thinkingOptions: readonly string[];
}

interface ModelValue {
  model: string;
  thinking?: string;
}

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const modelPresentationFrom = (presentation: unknown, optionId: string): ModelPresentation => {
  const raw = presentation as Record<string, unknown> | null;
  if (typeof raw !== "object" || raw === null || raw.kind !== "model"
    || typeof raw.provider !== "string" || !isStringList(raw.options) || !isStringList(raw.thinkingOptions)) {
    throw new Error(`The start option ${optionId} does not provide a model presentation`);
  }
  return { provider: raw.provider, options: raw.options, thinkingOptions: raw.thinkingOptions };
};

const modelValueFrom = (value: unknown, optionId: string): ModelValue => {
  const raw = value as Record<string, unknown> | null;
  if (typeof raw !== "object" || raw === null || typeof raw.model !== "string"
    || (raw.thinking !== undefined && typeof raw.thinking !== "string")) {
    throw new Error(`The value of start option ${optionId} is not a model choice`);
  }
  return { model: raw.model, ...(typeof raw.thinking === "string" ? { thinking: raw.thinking } : {}) };
};

const modelLabel = (provider: string, model: string) => provider ? `${provider}/${model}` : model;

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const errorClass = "text-[0.75rem] text-destructive";

export function ModelControl({ disabled, error, option, setValue }: StartOptionControlContext) {
  const parsed = useMemo(() => {
    try {
      return { presentation: modelPresentationFrom(option.presentation, option.id), value: modelValueFrom(option.value, option.id) };
    } catch (cause) {
      return { message: messageOf(cause) };
    }
  }, [option]);

  if ("message" in parsed) return <p className={errorClass} role="alert">{parsed.message}</p>;
  const { presentation, value } = parsed;

  const chooseModel = (model: string) => {
    void setValue({ model });
  };

  const chooseThinking = (thinking: string) => {
    void setValue({ model: value.model, thinking });
  };

  const modelOptions = presentation.options.map((model) => ({ value: model, label: modelLabel(presentation.provider, model) }));
  const thinkingOptions = presentation.thinkingOptions.map((level) => ({ value: level, label: thinkingLabel(level) }));
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
      <ModelPickers appearance="composer" disabled={disabled} model={value.model} models={modelOptions} onModel={chooseModel}
        onReasoning={chooseThinking} reasoning={thinkingOptions} reasoningValue={value.thinking} />
      {error && <p className={`${errorClass} w-full`} role="alert">{error}</p>}
    </div>
  );
}
