import { useState } from "react";
import { useAccess } from "../AccessContext";
import { resumeRun } from "../api";
import { Button } from "../ui";
import { pausedRunText, runPause } from "./chat-target";

/** One line above the input while the run is paused: how many inputs wait, and the resume for those allowed to operate; a message resumes it too. */
export function PausedRunNotice({ runId, view }: { runId: string; view: unknown }) {
  const writable = useAccess().can("runs.write");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pause = runPause(view, runId);
  if (!pause) return null;
  const resume = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await resumeRun(runId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  return <div className="flex min-w-0 flex-col gap-0.5 px-1 pb-1.5 text-[0.8rem]" data-slot="paused-run">
    <div className="flex min-w-0 items-center gap-2">
      <p className="min-w-0 flex-1 truncate text-muted-foreground" role="status">{pausedRunText(pause.waiting)}</p>
      <Button disabled={busy || !writable} onClick={() => void resume()} size="xs" title="Continue the run without a message" variant="outline">
        Resume
      </Button>
    </div>
    {error && <p className="text-[0.7rem] text-destructive" role="alert">{error}</p>}
  </div>;
}
