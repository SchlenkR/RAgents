import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { useAccess } from "../AccessContext";
import { StartTiles, startTileCount } from "../StartTiles";
import { Button } from "../ui";
import { SectionHeading } from "../ui/SectionLabel";
import type { PanelAction, PanelState } from "./contract";
import type { PanelPageProps } from "./page-props";
import { canDeleteRun, RunCard, RunLine, RunList } from "./RunLine";

const RECENT_RUNS = 5;

type NewRun = Extract<PanelAction, { action: "newRun" }>;

interface PendingStart {
  readonly action: NewRun;
  readonly state: PanelState;
}

export function StartPage({ state, send, registry }: PanelPageProps) {
  const access = useAccess();
  const [start, setStart] = useState<PendingStart>();
  const starting = start?.state === state ? start.action : undefined;
  const startRun = (action: NewRun) => {
    send(action);
    setStart({ action, state });
  };
  const connection = state.connections[0]!;
  const runs = [...connection.runs].sort((left, right) => right.updatedAt - left.updatedAt);
  const recent = runs.slice(0, RECENT_RUNS);
  const actions = recent.some((run) => run.canShare === true || canDeleteRun(connection, run));
  const tiles = startTileCount(connection.entries, connection.defaultEntry, connection.canCreateFree !== false);
  const openRun = (runId: string) => send({ action: "openRun", name: connection.name, runId });
  return <div className="grid min-w-0 grid-cols-1 gap-8">
    {state.problem && <p className="type-body text-destructive [overflow-wrap:anywhere]" role="alert">{state.problem}</p>}
    {state.notice && <p className="type-body text-muted-foreground [overflow-wrap:anywhere]" role="status">{state.notice}</p>}
    {connection.canCreate && <section className="grid grid-cols-1 gap-3">
      <SectionHeading count={tiles} title="New" />
      <StartTiles defaultEntry={connection.defaultEntry} disabled={starting !== undefined} entries={connection.entries} label="Templates"
        onNewChat={connection.canCreateFree === false ? undefined : () => startRun({ action: "newRun", name: connection.name })}
        onStart={(entryId) => startRun({ action: "newRun", name: connection.name, entryId })} starting={starting} />
    </section>}
    <section className="grid grid-cols-1 gap-3">
      <SectionHeading title="Continue">
        {runs.length > 0 && <Button onClick={() => send({ action: "page", page: "runs" })} size="xs" variant="ghost">All {runs.length} runs<ChevronRightIcon data-icon="inline-end" /></Button>}
      </SectionHeading>
      {runs.length === 0
        ? <p className="type-body text-muted-foreground">No runs yet.</p>
        : <RunCard>
          <RunList actions={actions} label="Recent">
            {recent.map((run) => <RunLine actions={actions} key={run.id} onOpen={() => openRun(run.id)}
              onDelete={canDeleteRun(connection, run) ? () => send({ action: "deleteRuns", name: connection.name, runIds: [run.id] }) : undefined}
              onShare={run.canShare ? () => send(state.sharing?.runId === run.id ? { action: "closeSharing" } : { action: "openSharing", name: connection.name, runId: run.id }) : undefined}
              run={run} sharingOpen={state.sharing?.runId === run.id} />)}
          </RunList>
        </RunCard>}
    </section>
    {registry?.startSections.filter((section) => !section.readRight || access.can(section.readRight))
      .map(({ id, Section }) => <Section key={id} onOpenRun={openRun} runs={runs} />)}
  </div>;
}
