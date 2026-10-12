import { Button, Checkbox, DetailRow, ToggleGroup, ToggleGroupItem } from "../ui";
import { useMemo, useState } from "react";
import type { StartOptionBadgeContext, StartOptionControlContext } from "../PluginRegistry";

interface SystemPromptOption {
  id: string;
  label: string;
  text: string;
}

interface SystemPromptPresentation {
  options: readonly SystemPromptOption[];
}

interface SystemPromptValue {
  promptIds: readonly string[];
  shareWithAgents: boolean;
}

const isPromptOption = (value: unknown): value is SystemPromptOption =>
  typeof value === "object" && value !== null
  && typeof (value as SystemPromptOption).id === "string"
  && typeof (value as SystemPromptOption).label === "string"
  && typeof (value as SystemPromptOption).text === "string";

const presentationFrom = (presentation: unknown, optionId: string): SystemPromptPresentation => {
  const raw = presentation as Record<string, unknown> | null;
  if (typeof raw !== "object" || raw === null || raw.kind !== "system-prompt"
    || !Array.isArray(raw.options) || !raw.options.every(isPromptOption)) {
    throw new Error(`The start option ${optionId} does not provide a system prompt presentation`);
  }
  return { options: raw.options };
};

const valueFrom = (value: unknown, optionId: string): SystemPromptValue => {
  const raw = value as Record<string, unknown> | null;
  if (typeof raw !== "object" || raw === null
    || !Array.isArray(raw.promptIds) || raw.promptIds.some((id) => typeof id !== "string")
    || typeof raw.shareWithAgents !== "boolean") {
    throw new Error(`The value of start option ${optionId} is not a system prompt selection`);
  }
  return { promptIds: raw.promptIds as string[], shareWithAgents: raw.shareWithAgents };
};

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const errorClass = "text-[0.75rem] text-destructive";

const parse = (option: StartOptionControlContext["option"]) => {
  try {
    return { presentation: presentationFrom(option.presentation, option.id), value: valueFrom(option.value, option.id) };
  } catch (cause) {
    return { message: messageOf(cause) };
  }
};

export function SystemPromptControl({ disabled, error, option, setValue }: StartOptionControlContext) {
  const [preview, setPreview] = useState(false);
  const parsed = useMemo(() => parse(option), [option]);
  if ("message" in parsed) return <p className={errorClass} role="alert">{parsed.message}</p>;
  const { presentation, value } = parsed;

  const share = (shareWithAgents: boolean) => {
    void setValue({ promptIds: value.promptIds, shareWithAgents });
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <span className="text-[0.72rem] font-semibold text-muted-foreground">System prompts</span>
      <div className="flex min-w-0 flex-col items-start gap-2">
        <ToggleGroup aria-label="System prompts" disabled={disabled} multiple size="sm" value={value.promptIds}
          onValueChange={(next) => { void setValue({ promptIds: presentation.options.map((entry) => entry.id).filter((id) => next.includes(id)), shareWithAgents: value.shareWithAgents }); }}>
          {presentation.options.map((entry) => (
            <ToggleGroupItem
              key={entry.id}
              value={entry.id}
            >
              {entry.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {presentation.options.length > 0 && <Button aria-expanded={preview} onClick={() => setPreview((current) => !current)} size="sm" variant="ghost">{preview ? "Hide prompt text" : "Show prompt text"}</Button>}
        {preview && <div className="flex max-h-80 min-w-0 flex-col gap-3 overflow-y-auto">
          {presentation.options.map((entry) => <div key={entry.id}>
            <strong className="text-sm">{entry.label}</strong>
            <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{entry.text}</p>
          </div>)}
        </div>}
      </div>
      <label className="flex max-w-[34rem] cursor-pointer items-start gap-2 text-sm">
        <Checkbox
          checked={value.shareWithAgents}
          className="mt-0.5"
          disabled={disabled}
          onCheckedChange={(checked) => share(checked)}
        />
        <span>
          Also pass on to the agents
          <span className="block text-[0.72rem] text-muted-foreground">
            {value.shareWithAgents
              ? "Spawned agents get the prompts as well. Plain LLMs with tools: [] are excluded."
              : "The prompts apply only to the coordinator."}
          </span>
        </span>
      </label>
      {error && <p className={errorClass} role="alert">{error}</p>}
    </div>
  );
}

export function SystemPromptBadge({ option }: StartOptionBadgeContext) {
  if (!option.selectable || !option.locked) return null;
  const parsed = parse(option);
  if ("message" in parsed) return <DetailRow label="System prompts"><span className="text-destructive" role="alert">{parsed.message}</span></DetailRow>;
  const { presentation, value } = parsed;
  const labels = presentation.options
    .filter((entry) => value.promptIds.includes(entry.id))
    .map((entry) => entry.label);
  if (labels.length === 0) return null;
  const explanation = value.shareWithAgents
    ? "These instructions guide the coordinator and the agents it starts."
    : "These instructions guide only the coordinator.";
  const text = labels.join(" + ");
  return (
    <DetailRow explanation={explanation} label="System prompts">{text}</DetailRow>
  );
}
