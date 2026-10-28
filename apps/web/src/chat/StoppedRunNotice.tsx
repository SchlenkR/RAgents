import { Badge } from "../ui";
import { runStopped, stoppedRunText } from "./chat-target";

export function StoppedRunNotice({ runId, view }: { runId: string; view: unknown }) {
  const stopped = runStopped(view, runId);
  if (!stopped) return null;
  return <div className="flex min-w-0 px-1 pb-2 text-base" data-slot="stopped-run">
    <Badge className="min-w-0 truncate" role="status" tone="warning">{stoppedRunText(stopped.waiting)}</Badge>
  </div>;
}
