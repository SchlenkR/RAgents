import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@aicontainer/web/ui";
import { thinkingLabel } from "@aicontainer/web/lib/labels";
import type { StartOptionControlContext } from "@aicontainer/web/PluginRegistry";

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
    throw new Error(`Die Startoption ${optionId} liefert keine Modell-Darstellung`);
  }
  return { provider: raw.provider, options: raw.options, thinkingOptions: raw.thinkingOptions };
};

const modelValueFrom = (value: unknown, optionId: string): ModelValue => {
  const raw = value as Record<string, unknown> | null;
  if (typeof raw !== "object" || raw === null || typeof raw.model !== "string"
    || (raw.thinking !== undefined && typeof raw.thinking !== "string")) {
    throw new Error(`Der Wert der Startoption ${optionId} ist keine Modellwahl`);
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
    <div className="grid flex-1 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
      <Select disabled={disabled} items={modelOptions} value={value.model} onValueChange={(model) => { if (model !== null) chooseModel(model); }}>
        <SelectTrigger aria-label="Modell" className="min-w-0 max-w-full" size="sm"><SelectValue /></SelectTrigger>
        <SelectContent>{modelOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
      {presentation.thinkingOptions.length > 0 && (
        <Select disabled={disabled} items={thinkingOptions} value={value.thinking ?? ""} onValueChange={(thinking) => { if (thinking !== null) chooseThinking(thinking); }}>
          <SelectTrigger aria-label="Reasoning" className="min-w-0 max-w-full" size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>{thinkingOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
      )}
      {error && <p className={`${errorClass} col-span-full`} role="alert">{error}</p>}
    </div>
  );
}
