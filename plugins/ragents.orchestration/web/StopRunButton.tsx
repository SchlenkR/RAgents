import { useState } from "react";
import { useAccess } from "@ragents/web/AccessContext";
import type { SessionHeaderContext } from "@ragents/web/PluginRegistry";
import { Button, StopGlyph } from "@ragents/web/ui";
import { stopRun } from "@ragents/web/api";

const STOP_RUN_REASON = "Stopped by the operator";

export function StopRunHeader({ session }: SessionHeaderContext) {
  return <StopRunButton key={session.session.id} runId={session.session.id} />;
}

function StopRunButton({ runId }: { runId: string }) {
  const writable = useAccess().can("runs.write");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const stop = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await stopRun(runId, STOP_RUN_REASON);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  if (!writable) return null;
  return <div className="flex min-w-0 flex-wrap items-center gap-3">
    <Button disabled={busy} onClick={() => void stop()} size="sm" variant="destructive">
      <StopGlyph data-icon="inline-start" />Stop run
    </Button>
    <span className="text-xs text-muted-foreground">Stops all work and background commands in this run.</span>
    {error && <span className="w-full text-xs text-destructive [overflow-wrap:anywhere]" role="alert">{error}</span>}
  </div>;
}
