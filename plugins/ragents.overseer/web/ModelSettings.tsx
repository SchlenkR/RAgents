import { useAccess } from "@ragents/web/AccessContext";
import { Button } from "@ragents/web/ui";
import { ModelPickers } from "@ragents/web/product/ModelPickers";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { thinkingLabel } from "@ragents/web/lib/labels";
import { modelSettingsStore } from "./model-settings";
import type { OverseerModelSelection } from "../contract";

export function useModelSettings(active = true) {
  const state = useSyncExternalStore(modelSettingsStore.subscribe, modelSettingsStore.read);
  useEffect(() => { if (active) void modelSettingsStore.load(); }, [active]);
  return state;
}

const selectionKey = (provider: string, model: string) => JSON.stringify([provider, model]);

const noteClass = "mt-2 text-[0.73rem] text-muted-foreground";
const formNoteClass = "text-[0.8rem] leading-[1.5] text-muted-foreground";
const errorClass = "flex flex-wrap items-center gap-2 text-[0.8rem] text-destructive";

/** In the toolbar the pickers share a row with the actions; in Settings they lay out like the run defaults, with the note above full-width pickers. */
export function ModelSettings({ active = true, compact = false, disabled = false, actions }: { active?: boolean; compact?: boolean; disabled?: boolean; actions?: ReactNode }) {
  const access = useAccess();
  const readable = access.can("ragents.overseer.read");
  const writable = access.can("ragents.overseer.write") && access.can("settings.write");
  const state = useModelSettings(active && readable);
  const settings = state.settings;
  const model = settings?.models.find((entry) => entry.id === settings.model && entry.provider === settings.provider);
  const save = (selection: OverseerModelSelection) => { void modelSettingsStore.save(selection).catch(() => {}); };
  const modelOptions = settings?.models.map((entry) => ({ value: selectionKey(entry.provider, entry.id), label: entry.label })) ?? [];
  const thinkingOptions = model?.thinking.map((level) => ({ value: level, label: thinkingLabel(level) })) ?? [];
  if (!readable) return null;
  const saving = state.status === "saving";
  const spacing = compact ? "mt-2 " : "";
  const pickers = settings && model ? <ModelPickers appearance={compact ? "composer" : "form"} disabled={!writable || disabled || saving}
    model={selectionKey(settings.provider, settings.model)} models={modelOptions}
    onModel={(key) => {
      const next = settings.models.find((entry) => selectionKey(entry.provider, entry.id) === key);
      if (!next) throw new Error("The selected model is no longer available");
      const thinking = next.thinking.includes(settings.thinking) ? settings.thinking : next.thinking[0];
      if (!thinking) throw new Error("No reasoning level is configured for the model");
      save({ provider: next.provider, model: next.id, thinking });
    }}
    onReasoning={(thinking) => save({ provider: settings.provider, model: settings.model, thinking: thinking as typeof settings.thinking })}
    reasoning={thinkingOptions} reasoningValue={settings.thinking} />
    : state.status === "loading" ? <p className={`${compact ? noteClass : formNoteClass} min-w-0 flex-[0_1_auto]`} role="status">Loading models ...</p>
    : !state.error && <p className={`${spacing}${errorClass} min-w-0 flex-[0_1_auto]`} role="alert">The stored model is missing from the model catalog.</p>;
  const failure = state.error && <div className={`${spacing}${errorClass}`} role="alert">
    <span>{state.error}</span>
    <Button onClick={() => { void modelSettingsStore.load(); }} variant="outline">Reload</Button>
  </div>;
  if (!compact) return (
    <section aria-label="Model of the global coordinator" className="grid min-w-0 gap-4">
      {settings && model && <p className={formNoteClass} role="status">{saving ? "Saving ..." : "Applies from the next answer on. The conversation history is kept."}</p>}
      {pickers}
      {actions}
      {failure}
    </section>
  );
  return (
    <section aria-label="Model of the global coordinator" className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2 max-md:gap-1">
        {pickers}
        {actions && <div className="ml-auto flex-none">{actions}</div>}
      </div>
      {settings && model && saving && <p className={noteClass} role="status">Saving ...</p>}
      {failure}
    </section>
  );
}
