import { ChevronRightIcon } from "lucide-react";
import { createContext, useContext } from "react";
import type { StartWidget, StartWidgetProps, StartWidgetSettings } from "../PluginRegistry";
import { StartTiles } from "../StartTiles";
import { Button } from "../ui";
import type { ConnectionView, PanelAction, PanelSharing } from "./contract";
import { canDeleteRun, RunCard, RunLine, RunList } from "./RunLine";

/** What Start's own widgets need from the page besides their props: the server, its actions, and the start under way. */
export interface StartPageHost {
  readonly connection: ConnectionView;
  readonly sharing: PanelSharing | undefined;
  readonly send: (action: PanelAction) => void;
  /** The start under way, New chat without entryId; it locks every template. */
  readonly starting: { readonly entryId?: string } | undefined;
  /** Without an entry it starts New chat. */
  readonly startRun: (entryId?: string) => void;
}

export const StartPageContext = createContext<StartPageHost | undefined>(undefined);

const useStartPage = (): StartPageHost => {
  const host = useContext(StartPageContext);
  if (host === undefined) throw new Error("Start's own widgets need the Start page around them.");
  return host;
};

const newSettings = {
  descriptions: { type: "boolean", label: "Show descriptions", description: "Each template shows its description below its title.", default: true },
} as const satisfies StartWidgetSettings;

/** The templates the viewer may start; nothing for a viewer who may not create runs. */
function NewWidget({ settings }: StartWidgetProps<typeof newSettings>) {
  const { connection, starting, startRun } = useStartPage();
  if (!connection.canCreate) return null;
  return <StartTiles defaultEntry={connection.defaultEntry} descriptions={settings.descriptions} disabled={starting !== undefined} entries={connection.entries} label="Templates"
    onNewChat={connection.canCreateFree === false ? undefined : () => startRun()} onStart={startRun} starting={starting} />;
}

const continueSettings = {
  runs: { type: "number", label: "Number of runs", description: "How many of the most recent runs Continue lists.", default: 15, min: 3, max: 100 },
} as const satisfies StartWidgetSettings;

/** The most recent runs and the way to all of them. */
function ContinueWidget({ runs, onOpenRun, settings }: StartWidgetProps<typeof continueSettings>) {
  const { connection, sharing, send } = useStartPage();
  if (runs.length === 0) return <p className="type-body text-muted-foreground">No runs yet.</p>;
  const recent = runs.slice(0, settings.runs);
  const actions = recent.some((run) => run.canShare === true || canDeleteRun(connection, run));
  return <div className="grid min-w-0 gap-2">
    <RunCard>
      <RunList actions={actions} label="Recent">
        {recent.map((run) => <RunLine actions={actions} key={run.id} onOpen={() => onOpenRun(run.id)}
          onDelete={canDeleteRun(connection, run) ? () => send({ action: "deleteRuns", name: connection.name, runIds: [run.id] }) : undefined}
          onShare={run.canShare ? () => send(sharing?.runId === run.id ? { action: "closeSharing" } : { action: "openSharing", name: connection.name, runId: run.id }) : undefined}
          run={run} sharingOpen={sharing?.runId === run.id} />)}
      </RunList>
    </RunCard>
    <Button className="justify-self-end" onClick={() => send({ action: "page", page: "runs" })} size="xs" variant="ghost">All {runs.length} runs<ChevronRightIcon data-icon="inline-end" /></Button>
  </div>;
}

/** Start's own widgets; the registry adds them to the plugins' widgets, and their order puts them first. */
export const HOST_START_WIDGETS: readonly StartWidget[] = [
  {
    id: "start.new", order: -20, title: "New", description: "Start a run from a template of this server or as a new chat.", columns: 2, minColumns: 2,
    settings: newSettings, render: (props) => <NewWidget {...props} />,
  },
  {
    id: "start.continue", order: -10, title: "Continue", description: "Your most recent runs, with the way to all of them.", columns: 4, minColumns: 2,
    settings: continueSettings, render: (props) => <ContinueWidget {...props} />,
  },
];
