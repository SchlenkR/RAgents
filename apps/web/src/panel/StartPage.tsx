import { ChevronRightIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useAccess } from "../AccessContext";
import { START_WIDGET_SPANS } from "../PluginRegistry";
import { StartTiles, startTileCount } from "../StartTiles";
import { Button } from "../ui";
import type { PanelAction, PanelState } from "./contract";
import type { PanelPageProps } from "./page-props";
import { canDeleteRun, RunCard, RunLine, RunList } from "./RunLine";
import { StartDashboard, type StartWidget } from "./StartDashboard";
import { useStartWidgets } from "./start-widgets";

const RECENT_RUNS = 15;

type NewRun = Extract<PanelAction, { action: "newRun" }>;

interface PendingStart {
  readonly action: NewRun;
  readonly state: PanelState;
}

export function StartPage({ state, send, registry, preferences }: PanelPageProps) {
  const access = useAccess();
  const [start, setStart] = useState<PendingStart>();
  const starting = start?.state === state ? start.action : undefined;
  const startRun = (action: NewRun) => {
    send(action);
    setStart({ action, state });
  };
  const connection = state.connections[0]!;
  const runs = useMemo(() => [...connection.runs].sort((left, right) => right.updatedAt - left.updatedAt), [connection.runs]);
  const recent = runs.slice(0, RECENT_RUNS);
  const actions = recent.some((run) => run.canShare === true || canDeleteRun(connection, run));
  const tiles = startTileCount(connection.entries, connection.defaultEntry, connection.canCreateFree !== false);
  const openRun = useCallback((runId: string) => send({ action: "openRun", name: connection.name, runId }), [connection.name, send]);
  const dynamic = useStartWidgets(registry, { runs, onOpenRun: openRun }).filter((widget) => !widget.readRight || access.can(widget.readRight));
  const sections = registry?.startSections.filter((section) => !section.readRight || access.can(section.readRight)) ?? [];
  const widgets: readonly StartWidget[] = [
    ...(connection.canCreate ? [{
      key: "start.new", title: "New", description: "Start a run from a template of this server or as a new chat.", count: tiles, span: "narrow" as const, sizes: START_WIDGET_SPANS,
      content: <StartTiles defaultEntry={connection.defaultEntry} disabled={starting !== undefined} entries={connection.entries} label="Templates"
        onNewChat={connection.canCreateFree === false ? undefined : () => startRun({ action: "newRun", name: connection.name })}
        onStart={(entryId) => startRun({ action: "newRun", name: connection.name, entryId })} starting={starting} />,
    }] : []),
    {
      key: "start.continue", title: "Continue", description: "Your most recent runs, with the way to all of them.", span: "wide", sizes: START_WIDGET_SPANS,
      action: runs.length > 0 ? <Button onClick={() => send({ action: "page", page: "runs" })} size="xs" variant="ghost">All {runs.length} runs<ChevronRightIcon data-icon="inline-end" /></Button> : undefined,
      content: runs.length === 0
        ? <p className="type-body text-muted-foreground">No runs yet.</p>
        : <RunCard>
          <RunList actions={actions} label="Recent">
            {recent.map((run) => <RunLine actions={actions} key={run.id} onOpen={() => openRun(run.id)}
              onDelete={canDeleteRun(connection, run) ? () => send({ action: "deleteRuns", name: connection.name, runIds: [run.id] }) : undefined}
              onShare={run.canShare ? () => send(state.sharing?.runId === run.id ? { action: "closeSharing" } : { action: "openSharing", name: connection.name, runId: run.id }) : undefined}
              run={run} sharingOpen={state.sharing?.runId === run.id} />)}
          </RunList>
        </RunCard>,
    },
    ...[...sections.map(({ id, title, description, span, sizes, order, Section }) => ({
      key: id, title, description, span: span ?? "full", sizes: sizes ?? START_WIDGET_SPANS, order, content: <Section onOpenRun={openRun} runs={runs} />,
    })), ...dynamic.map(({ id, title, description, span, sizes, order, content }) => ({
      key: id, title, description, span: span ?? "full", sizes: sizes ?? START_WIDGET_SPANS, order: order ?? 200, content,
    }))].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)),
  ];
  return <div className="grid min-w-0 grid-cols-1 gap-8">
    {state.problem && <p className="type-body text-destructive [overflow-wrap:anywhere]" role="alert">{state.problem}</p>}
    {state.notice && <p className="type-body text-muted-foreground [overflow-wrap:anywhere]" role="status">{state.notice}</p>}
    <StartDashboard preferences={preferences} widgets={widgets} />
  </div>;
}
