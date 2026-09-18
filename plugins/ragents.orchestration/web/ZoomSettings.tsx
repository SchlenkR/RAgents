import { useEffect, useState } from "react";
import { useAccess } from "@aicontainer/web/AccessContext";
import { Button, Input } from "@aicontainer/web/ui";
import { DEFAULT_PINCH_ZOOM_SENSITIVITY, savePinchZoomSensitivity, usePinchZoomSensitivity } from "./zoom-settings";

export function ZoomSettings() {
  const access = useAccess();
  const sensitivity = usePinchZoomSensitivity();
  const [value, setValue] = useState(String(sensitivity));
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => { setValue(String(sensitivity)); }, [sensitivity]);
  const writable = access.can("settings.write");
  const save = (next: number) => {
    if (!writable) return;
    setError(undefined);
    setMessage(undefined);
    try {
      savePinchZoomSensitivity(next);
      setValue(String(next));
      setMessage("Zoom-Empfindlichkeit gespeichert.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return <form className="grid gap-3" onSubmit={(event) => {
    event.preventDefault(); save(Number(value));
  }}>
    <p className="text-muted-foreground">Empfindlichkeit der Pinch-Geste auf dem Canvas. Faktor 1 entspricht dem bisherigen Verhalten, Faktor 2 ist doppelt so empfindlich. Gilt sofort für alle Runs in diesem Browser.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1.5"><span>Pinch-Zoom-Faktor</span><Input className="w-[130px]" type="number" required step="0.1" min="0.1" max="10"
        disabled={!writable} value={value} onChange={(event) => { setValue(event.target.value); setMessage(undefined); }} /></label>
      <Button type="submit" disabled={!writable}>Speichern</Button>
      <Button disabled={!writable} onClick={() => save(DEFAULT_PINCH_ZOOM_SENSITIVITY)} variant="outline">Zurücksetzen</Button>
    </div>
    {error ? <p className="text-muted-foreground" role="alert">{error}</p> : message && <p className="text-muted-foreground" role="status">{message}</p>}
  </form>;
}
