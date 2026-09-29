import { useEffect, useState } from "react";
import { useAccess } from "@ragents/web/AccessContext";
import { Button, Input } from "@ragents/web/ui";
import { RUN_PANEL_SETTINGS_LIMITS, DEFAULT_RUN_PANEL_SETTINGS, saveRunPanelSettings, useRunPanelSettings, type RunPanelSettings as RunPanelSettingsValue } from "./run-panel-settings";

type Draft = Record<keyof RunPanelSettingsValue, string>;

const toDraft = (value: RunPanelSettingsValue): Draft => ({ sideWidth: String(value.sideWidth), openDelay: String(value.openDelay), closeDelay: String(value.closeDelay) });

const fields: readonly { key: keyof RunPanelSettingsValue; label: string; unit: string }[] = [
  { key: "sideWidth", label: "Chat next to the mini-app from", unit: "px" },
  { key: "openDelay", label: "Slide up after", unit: "ms" },
  { key: "closeDelay", label: "Slide back after leaving after", unit: "ms" },
];

export function RunPanelSettings() {
  const access = useAccess();
  const stored = useRunPanelSettings();
  const [draft, setDraft] = useState(() => toDraft(stored));
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => { setDraft(toDraft(stored)); }, [stored]);
  const writable = access.can("settings.write");
  const save = (next: RunPanelSettingsValue) => {
    if (!writable) return;
    setError(undefined);
    setMessage(undefined);
    try {
      saveRunPanelSettings(next);
      setMessage("Run panel settings saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return <form className="grid gap-3" onSubmit={(event) => {
    event.preventDefault();
    save({ sideWidth: Number(draft.sideWidth), openDelay: Number(draft.openDelay), closeDelay: Number(draft.closeDelay) });
  }}>
    <p className="text-muted-foreground">From this panel width on, the chat sits to the right of the mini-app instead of as a sheet below it. The delays determine how long the mouse must rest over the sheet until it slides up, and how long it stays up after leaving. Applies immediately to all runs in this browser.</p>
    <div className="flex flex-wrap items-end gap-3">
      {fields.map(({ key, label, unit }) => <label className="grid gap-1.5" key={key}>
        <span>{label} ({unit})</span>
        <Input className="w-[130px]" disabled={!writable} max={RUN_PANEL_SETTINGS_LIMITS[key].max} min={RUN_PANEL_SETTINGS_LIMITS[key].min} onChange={(event) => { setDraft({ ...draft, [key]: event.target.value }); setMessage(undefined); }} required step="1" type="number" value={draft[key]} />
      </label>)}
      <Button disabled={!writable} type="submit">Save</Button>
      <Button disabled={!writable} onClick={() => save(DEFAULT_RUN_PANEL_SETTINGS)} variant="outline">Reset</Button>
    </div>
    {error ? <p className="text-muted-foreground" role="alert">{error}</p> : message && <p className="text-muted-foreground" role="status">{message}</p>}
  </form>;
}
