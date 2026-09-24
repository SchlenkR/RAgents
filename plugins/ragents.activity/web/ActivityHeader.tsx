import { useEffect, useMemo, useState } from "react";
import {
  activeActivity,
  activitySourceFrom,
  elapsedLabel,
  type ActivityEntry,
} from "./activity";
import { ToolbarCopy, ToolbarItem, ToolbarLabel, ToolbarText } from "@ragents/web/Toolbar";
import type { SessionHeaderContext } from "@ragents/web/PluginRegistry";

const kindLabels: Readonly<Record<ActivityEntry["kind"], string>> = {
  tool: "Tool",
  turn: "Turn",
};

const titleOf = (entry: ActivityEntry) =>
  entry.kind === "tool" ? `Werkzeug läuft: ${entry.label}` : `Turn läuft: ${entry.label}`;

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
    <div aria-label="Was gerade läuft" className="flex min-w-0 flex-none items-stretch self-stretch" role="status">
      {state.entries.map((entry) => {
        const elapsed = elapsedLabel(entry.startedAt, now);
        return (
          <ToolbarItem className="w-45" data-kind={entry.kind} key={entry.id} title={titleOf(entry)}>
            <i aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground animate-fade-pulse motion-reduce:animate-none in-data-[kind=tool]:bg-primary" />
            <ToolbarCopy className="flex-1">
              <ToolbarLabel className="flex items-baseline gap-2">
                <span>{kindLabels[entry.kind]}</span>
                {elapsed && <small className="ml-auto whitespace-nowrap text-[inherit] tabular-nums">{elapsed}</small>}
              </ToolbarLabel>
              <ToolbarText>{entry.label}</ToolbarText>
            </ToolbarCopy>
          </ToolbarItem>
        );
      })}
      {state.hidden > 0 && (
        <ToolbarItem className="text-muted-foreground">+{state.hidden} weitere</ToolbarItem>
      )}
    </div>
  );
}
