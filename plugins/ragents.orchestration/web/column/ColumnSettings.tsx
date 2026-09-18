import { useEffect, useState } from "react";
import { useAccess } from "@aicontainer/web/AccessContext";
import { Button, Input } from "@aicontainer/web/ui";
import { COLUMN_SETTINGS_LIMITS, DEFAULT_COLUMN_SETTINGS, saveColumnSettings, useColumnSettings, type ColumnSettings as ColumnSettingsValue } from "./column-settings";

type Draft = Record<keyof ColumnSettingsValue, string>;

const toDraft = (value: ColumnSettingsValue): Draft => ({ sideWidth: String(value.sideWidth), openDelay: String(value.openDelay), closeDelay: String(value.closeDelay) });

const fields: readonly { key: keyof ColumnSettingsValue; label: string; unit: string }[] = [
  { key: "sideWidth", label: "Chat neben der Mini-App ab", unit: "px" },
  { key: "openDelay", label: "Hochschieben nach", unit: "ms" },
  { key: "closeDelay", label: "Zurück nach Verlassen nach", unit: "ms" },
];

export function ColumnSettings() {
  const access = useAccess();
  const stored = useColumnSettings();
  const [draft, setDraft] = useState(() => toDraft(stored));
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => { setDraft(toDraft(stored)); }, [stored]);
  const writable = access.can("settings.write");
  const save = (next: ColumnSettingsValue) => {
    if (!writable) return;
    setError(undefined);
    setMessage(undefined);
    try {
      saveColumnSettings(next);
      setMessage("Einstellungen der Arbeitsspalte gespeichert.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return <form className="grid gap-3" onSubmit={(event) => {
    event.preventDefault();
    save({ sideWidth: Number(draft.sideWidth), openDelay: Number(draft.openDelay), closeDelay: Number(draft.closeDelay) });
  }}>
    <p className="text-muted-foreground">Ab dieser Breite der Spalte liegt der Chat rechts neben der Mini-App statt als Sheet darunter. Die Verzögerungen bestimmen, wie lange die Maus über dem Sheet liegen muss, bis es hochgleitet, und wie lange es nach dem Verlassen oben bleibt. Gilt sofort für alle Runs in diesem Browser.</p>
    <div className="flex flex-wrap items-end gap-3">
      {fields.map(({ key, label, unit }) => <label className="grid gap-1.5" key={key}>
        <span>{label} ({unit})</span>
        <Input className="w-[130px]" disabled={!writable} max={COLUMN_SETTINGS_LIMITS[key].max} min={COLUMN_SETTINGS_LIMITS[key].min} onChange={(event) => { setDraft({ ...draft, [key]: event.target.value }); setMessage(undefined); }} required step="1" type="number" value={draft[key]} />
      </label>)}
      <Button disabled={!writable} type="submit">Speichern</Button>
      <Button disabled={!writable} onClick={() => save(DEFAULT_COLUMN_SETTINGS)} variant="outline">Zurücksetzen</Button>
    </div>
    {error ? <p className="text-muted-foreground" role="alert">{error}</p> : message && <p className="text-muted-foreground" role="status">{message}</p>}
  </form>;
}
