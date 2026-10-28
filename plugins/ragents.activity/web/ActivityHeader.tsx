import { useEffect, useMemo, useState } from "react";
import {
  activeActivity,
  activitySourceFrom,
  elapsedLabel,
  type ActivityEntry,
} from "./activity";
import { DetailRow } from "@ragents/web/ui";
import type { SessionHeaderContext } from "@ragents/web/PluginRegistry";

const kindLabels: Readonly<Record<ActivityEntry["kind"], string>> = {
  tool: "Tool",
  turn: "Turn",
};

export function ActivityHeader({ session }: SessionHeaderContext) {
  const state = useMemo(
    () => activeActivity(activitySourceFrom(session.runView)),
    [session.runView],
  );
  const active = state.entries.length > 0;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active) return null;

  return (
    <div aria-label="What is running right now" className="min-w-0" role="status">
      {state.entries.map((entry) => {
        const elapsed = elapsedLabel(entry.startedAt, now);
        return (
          <DetailRow key={entry.id} label={kindLabels[entry.kind]} explanation={entry.kind === "tool" ? "An agent is doing this step." : "This agent is working on a message."}>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1" data-kind={entry.kind}>
              <span className="min-w-0 flex-[1_1_12rem]" data-slot="activity-name">{entry.label}</span>
              {elapsed && <span aria-label={`Elapsed time ${elapsed}`} className="flex-none whitespace-nowrap text-sm text-muted-foreground tabular-nums" data-slot="activity-elapsed">{elapsed}</span>}
            </div>
          </DetailRow>
        );
      })}
      {state.hidden > 0 && (
        <DetailRow label="Other work">{state.hidden} more steps are running.</DetailRow>
      )}
    </div>
  );
}
