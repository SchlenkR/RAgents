import { Checkbox, Toggle } from "@aicontainer/web/ui";
import { ToolbarCopy, ToolbarItem, ToolbarLabel, ToolbarText } from "@aicontainer/web/Toolbar";
import { useMemo, useState } from "react";
import type { StartOptionBadgeContext, StartOptionControlContext } from "@aicontainer/web/PluginRegistry";

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
    throw new Error(`Die Startoption ${optionId} liefert keine Systemprompt-Darstellung`);
  }
  return { options: raw.options };
};

const valueFrom = (value: unknown, optionId: string): SystemPromptValue => {
  const raw = value as Record<string, unknown> | null;
  if (typeof raw !== "object" || raw === null
    || !Array.isArray(raw.promptIds) || raw.promptIds.some((id) => typeof id !== "string")
    || typeof raw.shareWithAgents !== "boolean") {
    throw new Error(`Der Wert der Startoption ${optionId} ist keine Systemprompt-Auswahl`);
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
  const [previewId, setPreviewId] = useState<string | undefined>(undefined);
  const parsed = useMemo(() => parse(option), [option]);
  if ("message" in parsed) return <p className={errorClass} role="alert">{parsed.message}</p>;
  const { presentation, value } = parsed;
  const preview = presentation.options.find((entry) => entry.id === previewId);

  const toggle = (wanted: string) => {
    const next = value.promptIds.includes(wanted)
      ? value.promptIds.filter((id) => id !== wanted)
      : presentation.options.map((entry) => entry.id).filter((id) => id === wanted || value.promptIds.includes(id));
    void setValue({ promptIds: next, shareWithAgents: value.shareWithAgents });
  };

  const share = (shareWithAgents: boolean) => {
    void setValue({ promptIds: value.promptIds, shareWithAgents });
  };

  return (
    <div className="flex flex-col items-start gap-2" onMouseLeave={() => setPreviewId(undefined)}>
      <span className="text-[0.72rem] font-semibold text-muted-foreground">Systemprompts</span>
      <div className="relative flex justify-center">
        <div aria-label="Systemprompts" className="flex flex-wrap justify-center gap-2" role="group">
          {presentation.options.map((entry) => (
            <Toggle
              disabled={disabled}
              key={entry.id}
              onBlur={() => setPreviewId(undefined)}
              onFocus={() => setPreviewId(entry.id)}
              onMouseEnter={() => setPreviewId(entry.id)}
              onPressedChange={() => toggle(entry.id)}
              pressed={value.promptIds.includes(entry.id)}
              size="sm"
              variant="outline"
            >
              {entry.label}
            </Toggle>
          ))}
        </div>
        {preview && <div className="absolute top-[calc(100%+6px)] left-1/2 z-3 max-h-[44vh] w-max max-w-[min(620px,78vw)] -translate-x-1/2 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-background px-3.5 py-3 text-left text-sm leading-[1.5] text-foreground shadow-pop" role="tooltip">{preview.text}</div>}
      </div>
      <label className="flex max-w-[34rem] cursor-pointer items-start gap-2 text-sm">
        <Checkbox
          checked={value.shareWithAgents}
          className="mt-0.5"
          disabled={disabled}
          onCheckedChange={(checked) => share(checked)}
        />
        <span>
          Auch an die Agenten weiterreichen
          <span className="block text-[0.72rem] text-muted-foreground">
            {value.shareWithAgents
              ? "Erzeugte Agenten bekommen die Prompts zusätzlich. Plain-LLMs mit tools: [] bleiben ausgenommen."
              : "Die Prompts gelten nur für den Koordinator."}
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
  if ("message" in parsed) return <ToolbarItem title={parsed.message}><ToolbarText>Systemprompts unlesbar</ToolbarText></ToolbarItem>;
  const { presentation, value } = parsed;
  const labels = presentation.options
    .filter((entry) => value.promptIds.includes(entry.id))
    .map((entry) => entry.label);
  if (labels.length === 0) return null;
  const scopeLabel = value.shareWithAgents ? "Koordinator und Agenten" : "nur Koordinator";
  const text = labels.join(" + ");
  return (
    <ToolbarItem title={`Systemprompts: ${text} (${scopeLabel})`}>
      <ToolbarCopy><ToolbarLabel>Systemprompts</ToolbarLabel><ToolbarText>{value.shareWithAgents ? `${text} + Agenten` : text}</ToolbarText></ToolbarCopy>
    </ToolbarItem>
  );
}
