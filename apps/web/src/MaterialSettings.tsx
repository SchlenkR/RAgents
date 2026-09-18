import { useEffect, useId, useState } from "react";
import { useAccess } from "./AccessContext";
import { DEFAULT_MATERIAL_SETTINGS, MATERIAL_SETTINGS_LIMITS, resetMaterialSettings, saveMaterialSettings, useMaterialSettings } from "./material-settings";
import { Button, Input } from "./ui";

const noteClasses = "text-sm leading-[1.6] text-muted-foreground";

export function MaterialSettings() {
  const { settings, error } = useMaterialSettings();
  const writable = useAccess().can("settings.write");
  const prefix = useId();
  const [steps, setSteps] = useState(String(settings.steps));
  useEffect(() => { setSteps(String(settings.steps)); }, [settings]);
  const valid = (text: string, min: number, max: number) => text.trim() !== "" && Number.isInteger(Number(text)) && Number(text) >= min && Number(text) <= max;
  const stepsValid = valid(steps, MATERIAL_SETTINGS_LIMITS.minSteps, MATERIAL_SETTINGS_LIMITS.maxSteps);
  const changeSteps = (value: string) => {
    if (!writable) return;
    setSteps(value);
    if (valid(value, MATERIAL_SETTINGS_LIMITS.minSteps, MATERIAL_SETTINGS_LIMITS.maxSteps)) saveMaterialSettings({ ...settings, steps: Number(value) });
  };
  return <div className="flex min-w-0 max-w-[680px] flex-col gap-5">
    <p className={noteClasses}>Schichtwerk mit matten Flächen und gestapelter Tiefe. Änderungen gelten sofort für alle Runs und werden in diesem Browser gespeichert.</p>
    <div className="flex flex-col gap-2">
      <label className="text-sm font-semibold text-foreground" id={`${prefix}-steps-label`} htmlFor={`${prefix}-steps`}>Tiefenstufen</label>
      <div className="flex min-w-0 items-center gap-5">
        <input className="w-0 min-w-0 flex-1 accent-primary" aria-labelledby={`${prefix}-steps-label`} disabled={!writable} type="range" min={MATERIAL_SETTINGS_LIMITS.minSteps} max={MATERIAL_SETTINGS_LIMITS.maxSteps} step="1" value={settings.steps} onChange={(event) => changeSteps(event.target.value)} />
        <Input className="w-[84px] flex-none" id={`${prefix}-steps`} aria-invalid={!stepsValid} aria-describedby={`${prefix}-steps-note`} disabled={!writable} type="number" min={MATERIAL_SETTINGS_LIMITS.minSteps} max={MATERIAL_SETTINGS_LIMITS.maxSteps} step="1" value={steps} onChange={(event) => changeSteps(event.target.value)} />
      </div>
      <p id={`${prefix}-steps-note`} className={stepsValid ? noteClasses : "text-sm leading-[1.6] text-destructive"}>{stepsValid ? `0 ist flach, bis zu 5 gleich tiefe Stufen. Standard: ${DEFAULT_MATERIAL_SETTINGS.steps}.` : "Bitte eine ganze Zahl von 0 bis 5 eingeben."}</p>
    </div>
    <div><Button variant="outline" disabled={!writable} onClick={() => {
      if (!writable) return;
      if (resetMaterialSettings()) {
        setSteps(String(DEFAULT_MATERIAL_SETTINGS.steps));
      }
    }}>Auf Standard zurücksetzen</Button></div>
    {!writable && <p className={noteClasses}>Die Materialeinstellungen sind mit deinen Rechten nur lesbar.</p>}
    {error && <p className="text-sm leading-[1.6] text-destructive" role="alert">{error}</p>}
  </div>;
}
