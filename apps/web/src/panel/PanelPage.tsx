import { ConnectionsPage } from "./ConnectionsPage";
import type { PanelPageProps } from "./page-props";
import { RunsPage } from "./RunsPage";
import { ShareDialog } from "./ShareDialog";
import { StartPage } from "./StartPage";

/** The panel without an open run: Start, Runs, or Server in one centered column that starts at the same height on every page; the run itself lives in the run panel. */
export function PanelPage(props: PanelPageProps) {
  const { page, sharing } = props.state;
  if (page !== "connections" && props.state.connections.length !== 1) throw new Error("Start and Runs require exactly one server.");
  const shared = sharing && props.state.connections.find((connection) => connection.name === sharing.connection)?.runs.find((run) => run.id === sharing.runId);
  return <main data-page={page} className="h-full min-w-0 overflow-y-auto p-3 pt-6">
    <div className="@container/panel mx-auto w-full max-w-[1280px] min-w-0">
      {page === "connections" ? <ConnectionsPage {...props} /> : page === "runs" ? <RunsPage key={props.state.connections[0]!.name} {...props} /> : <StartPage {...props} />}
    </div>
    {sharing && <ShareDialog key={`${sharing.connection}\u0000${sharing.runId}`} onClose={() => props.send({ action: "closeSharing" })}
      onSave={(next) => props.send({ action: "share", name: sharing.connection, runId: sharing.runId, sharing: next })} runTitle={shared?.title} sharing={sharing} />}
  </main>;
}
