import { useEffect, useState } from "react";
import { useAccess } from "@aicontainer/web/AccessContext";
import { Button, Input } from "@aicontainer/web/ui";
import { ACTOR_CARD_SIZE_LIMITS, DEFAULT_ACTOR_CARD_SIZE, saveActorCardSize, useActorCardSize } from "./card-size-settings";

export function CardSizeSettings() {
  const access = useAccess();
  const size = useActorCardSize();
  const [width, setWidth] = useState(String(size.width));
  const [height, setHeight] = useState(String(size.height));
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => { setWidth(String(size.width)); setHeight(String(size.height)); }, [size]);
  const writable = access.can("settings.write");
  const save = (next: { width: number; height: number }) => {
    if (!writable) return;
    setError(undefined);
    setMessage(undefined);
    try {
      saveActorCardSize(next);
      setWidth(String(next.width));
      setHeight(String(next.height));
      setMessage("Standardgröße gespeichert.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return <form className="grid gap-3" onSubmit={(event) => {
    event.preventDefault(); save({ width: Number(width), height: Number(height) });
  }}>
    <p className="text-muted-foreground">Standardgröße der LLM-Karten auf dem Canvas, in Pixeln bei 100 Prozent Zoom. Gilt für alle Runs in diesem Browser. Individuell vergrößerte Karten behalten ihre Größe.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1.5"><span>Standardbreite</span><Input className="w-[130px]" type="number" required step="1" min={ACTOR_CARD_SIZE_LIMITS.minWidth} max={ACTOR_CARD_SIZE_LIMITS.maxWidth}
        disabled={!writable} value={width} onChange={(event) => { setWidth(event.target.value); setMessage(undefined); }} /></label>
      <label className="grid gap-1.5"><span>Standardhöhe</span><Input className="w-[130px]" type="number" required step="1" min={ACTOR_CARD_SIZE_LIMITS.minHeight} max={ACTOR_CARD_SIZE_LIMITS.maxHeight}
        disabled={!writable} value={height} onChange={(event) => { setHeight(event.target.value); setMessage(undefined); }} /></label>
      <Button type="submit" disabled={!writable}>Speichern</Button>
      <Button disabled={!writable} onClick={() => save(DEFAULT_ACTOR_CARD_SIZE)} variant="outline">Zurücksetzen</Button>
    </div>
    {error ? <p className="text-muted-foreground" role="alert">{error}</p> : message && <p className="text-muted-foreground" role="status">{message}</p>}
  </form>;
}
