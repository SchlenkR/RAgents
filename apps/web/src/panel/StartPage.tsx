import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { StartTiles, startTileCount } from "../StartTiles";
import { Button } from "../ui";
import { SectionHeading } from "../ui/SectionLabel";
import type { PanelAction, PanelState } from "./contract";
import type { PanelPageProps } from "./page-props";
import { RunLine, RunList } from "./RunLine";

const RECENT_RUNS = 5;

type NewRun = Extract<PanelAction, { action: "newRun" }>;

interface PendingStart {
  readonly action: NewRun;
  readonly state: PanelState;
}

export function StartPage({ state, send }: PanelPageProps) {
  const [start, setStart] = useState<PendingStart>();
  const starting = start?.state === state ? start.action : undefined;
  const startRun = (action: NewRun) => {
    send(action);
    setStart({ action, state });
  };
  const connection = state.connections[0]!;
  const runs = [...connection.runs].sort((left, right) => right.updatedAt - left.updatedAt);
  const recent = runs.slice(0, RECENT_RUNS);
  const sharing = recent.some((run) => run.canShare === true);
  const tiles = startTileCount(connection.entries, connection.defaultEntry, connection.canCreateFree !== false);
  return <div className="grid min-w-0 grid-cols-1 gap-8">
    {state.problem && <p className="type-body text-destructive [overflow-wrap:anywhere]" role="alert">{state.problem}</p>}
    {state.notice && <p className="type-body text-muted-foreground [overflow-wrap:anywhere]" role="status">{state.notice}</p>}
    <section className="grid grid-cols-1 gap-3">
      <SectionHeading title="Continue">
        {runs.length > 0 && <Button onClick={() => send({ action: "page", page: "runs" })} size="xs" variant="ghost">All {runs.length} runs<ChevronRightIcon data-icon="inline-end" /></Button>}
      </SectionHeading>
      {runs.length === 0
        ? <p className="type-body text-muted-foreground">No runs yet.</p>
        : <RunList actions={sharing} label="Recent">
          {recent.map((run) => <RunLine actions={sharing} key={run.id} onOpen={() => send({ action: "openRun", name: connection.name, runId: run.id })}
            onShare={run.canShare ? () => send({ action: "openSharing", name: connection.name, runId: run.id }) : undefined} run={run} />)}
        </RunList>}
    </section>
    {connection.canCreate && <section className="grid grid-cols-1 gap-3">
      <SectionHeading count={tiles} title="New" />
      <StartTiles defaultEntry={connection.defaultEntry} disabled={starting !== undefined} entries={connection.entries} label="Templates"
        onNewChat={connection.canCreateFree === false ? undefined : () => startRun({ action: "newRun", name: connection.name })}
        onStart={(entryId) => startRun({ action: "newRun", name: connection.name, entryId })} starting={starting} />
    </section>}
  </div>;
}
