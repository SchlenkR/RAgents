import { useState } from "react";
import { useAccess } from "@ragents/web/AccessContext";
import type { SessionHeaderContext } from "@ragents/web/PluginRegistry";
import { Button, StopGlyph } from "@ragents/web/ui";
import { stopRun } from "./api";

const STOP_RUN_REASON = "Emergency stop by the operator";

export function StopRunHeader({ session }: SessionHeaderContext) {
  return <StopRunButton key={session.session.id} runId={session.session.id} />;
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
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button onClick={() => setArmed(true)} size="sm" variant="destructive">
          <StopGlyph data-icon="inline-start" />Stop run
        </Button>
        <span className="text-xs text-muted-foreground">Stops all work and background commands in this run.</span>
      </div>
    );
  }

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-[0.72rem] font-semibold text-destructive">Really stop everything?</span>
      <Button disabled={busy} onClick={() => void stop()} size="sm" variant="destructive">Yes</Button>
      <Button disabled={busy} onClick={() => setArmed(false)} size="sm" variant="outline">
        Cancel
      </Button>
      {error && <span className="w-full text-xs text-destructive [overflow-wrap:anywhere]" role="alert">{error}</span>}
    </span>
  );
}
