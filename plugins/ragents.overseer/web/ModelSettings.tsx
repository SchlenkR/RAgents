import { useAccess } from "@ragents/web/AccessContext";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ragents/web/ui";
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
const errorClass = "mt-2 flex flex-wrap items-center gap-2 text-[0.8rem] text-destructive";
const triggerClass = "min-w-0 max-w-[min(320px,100%)]";

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
  return (
    <section aria-label="Modell des globalen Koordinators" className={compact ? "min-w-0 flex-1" : "min-w-0"}>
      <div className={compact ? "flex flex-nowrap items-center gap-2 max-md:gap-1" : "flex flex-wrap items-center gap-2.5"}>
        {settings && model ? <>
          <Select
            disabled={!writable || disabled || state.status === "saving"}
            items={modelOptions}
            value={selectionKey(settings.provider, settings.model)}
            onValueChange={(key) => {
              const next = settings.models.find((entry) => selectionKey(entry.provider, entry.id) === key);
              if (!next) throw new Error("Das ausgewählte Modell ist nicht mehr verfügbar");
              const thinking = next.thinking.includes(settings.thinking) ? settings.thinking : next.thinking[0];
              if (!thinking) throw new Error("Für das Modell ist keine Reasoning-Stufe konfiguriert");
              save({ provider: next.provider, model: next.id, thinking });
            }}
          >
            <SelectTrigger aria-label="Modell" className={`${triggerClass} ${compact ? "flex-1" : "flex-[0_1_auto]"}`} size={compact ? "sm" : "default"}><SelectValue /></SelectTrigger>
            <SelectContent>{modelOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select
            disabled={!writable || disabled || state.status === "saving" || model.thinking.length < 2}
            items={thinkingOptions}
            value={settings.thinking}
            onValueChange={(thinking) => { if (thinking !== null) save({ provider: settings.provider, model: settings.model, thinking }); }}
          >
            <SelectTrigger aria-label={compact ? "Reasoning" : "Reasoning-Tiefe"} className={`${triggerClass} flex-none`} size={compact ? "sm" : "default"}><SelectValue /></SelectTrigger>
            <SelectContent>{thinkingOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </> : state.status === "loading" ? <p className={`${noteClass} min-w-0 flex-[0_1_auto]`} role="status">Modelle werden geladen ...</p>
        : !state.error && <p className={`${errorClass} min-w-0 flex-[0_1_auto]`} role="alert">Das gespeicherte Modell fehlt im Modellkatalog.</p>}
        {actions && <div className="ml-auto flex-none">{actions}</div>}
      </div>
      {settings && model && (!compact || state.status === "saving") && <p className={noteClass} role="status">{state.status === "saving" ? "Wird gespeichert ..." : "Gilt ab der nächsten Antwort. Der Gesprächsverlauf bleibt erhalten."}</p>}
      {state.error && <div className={errorClass} role="alert">
        <span>{state.error}</span>
        <Button onClick={() => { void modelSettingsStore.load(); }} variant="outline">Erneut laden</Button>
      </div>}
    </section>
  );
}
