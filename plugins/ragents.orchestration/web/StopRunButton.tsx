import { useState } from "react";
import { useAccess } from "@aicontainer/web/AccessContext";
import type { SessionHeaderContext } from "@aicontainer/web/PluginRegistry";
import { Button } from "@aicontainer/web/ui";
import { ToolbarItem } from "@aicontainer/web/Toolbar";
import { stopRun } from "./api";

const STOP_RUN_REASON = "Not-Aus durch den Bediener";

export function StopRunHeader({ session }: SessionHeaderContext) {
  return <ToolbarItem className="max-w-none"><StopRunButton key={session.session.id} runId={session.session.id} /></ToolbarItem>;
}

function StopRunButton({ runId }: { runId: string }) {
  const writable = useAccess().can("runs.write");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const stop = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await stopRun(runId, STOP_RUN_REASON);
      setArmed(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  if (!writable) return null;
  if (!armed) {
    return (
      <Button onClick={() => setArmed(true)} size="sm" title="Beendet den ganzen Lauf: Turns, Agenten und Abläufe" variant="destructive">
        Lauf stoppen
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-[0.72rem] font-semibold text-destructive">Wirklich alles stoppen?</span>
      <Button disabled={busy} onClick={() => void stop()} size="sm" variant="destructive">Ja</Button>
      <Button disabled={busy} onClick={() => setArmed(false)} size="sm" variant="outline">
        Abbrechen
      </Button>
      {error && <span className="max-w-[260px] truncate text-[0.7rem] text-destructive" title={error}>{error}</span>}
    </span>
  );
}
