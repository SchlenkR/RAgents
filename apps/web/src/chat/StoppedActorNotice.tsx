import { useState, type ReactNode } from "react";
import { useAccess } from "../AccessContext";
import { restartChatActor } from "../api";
import type { RunActor } from "../run-view";
import { Button, cn } from "../ui";

/** Steht an der Stelle der Eingabe, solange der Actor des Chats gestoppt ist: Grund und, wer bedienen darf, der Neustart; toolbar behält die Knöpfe der Eingabe. */
export function StoppedActorNotice({ actor, runId, className, toolbar }: { actor: RunActor; runId: string; className?: string; toolbar?: ReactNode }) {
  const access = useAccess();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const reason = actor.lifecycle?.kind === "stopped" ? actor.lifecycle.reason : "";
  const restartable = access.can("runs.write") && access.can("runs.inspect");
  const restart = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await restartChatActor(runId, actor.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  return <div className={cn("flex min-w-0 flex-col gap-1.5 rounded-[var(--input-card-radius,var(--radius-xl))] border border-border-strong bg-background px-3 py-2 text-[0.8rem]", className)}
    data-slot="stopped-actor">
    <div className="flex min-w-0 items-center gap-2">
      <p className="min-w-0 flex-1 [overflow-wrap:anywhere]" role="status">
        <span className="font-semibold">@{actor.handle} gestoppt:</span> {reason}
      </p>
      {restartable && <Button disabled={busy} onClick={() => void restart()} size="sm" title={`@${actor.handle} neu starten; danach nimmt er wieder Nachrichten an`} variant="outline">
        Neu starten
      </Button>}
    </div>
    {!restartable && <p className="text-[0.7rem] text-muted-foreground">Er nimmt keine Nachrichten an, bis ihn jemand mit Bedienrechten neu startet.</p>}
    {error && <p className="text-[0.7rem] text-destructive" role="alert">{error}</p>}
    {toolbar && <div className="flex min-w-0 flex-wrap items-center gap-2">{toolbar}</div>}
  </div>;
}
