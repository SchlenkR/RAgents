import { useRef } from "react";
import { ConnectionsPage } from "./ConnectionsPage";
import type { PanelPageProps } from "./page-props";
import { RunsPage } from "./RunsPage";
import { SharePanel } from "./SharePanel";
import { StartPage } from "./StartPage";

/** The panel without an open run: Start, Runs, or Server in one centered column that starts at the same height on every page; the run itself lives in the run panel. */
export function PanelPage(props: PanelPageProps) {
  const main = useRef<HTMLElement>(null);
  const { page, sharing } = props.state;
  if (page !== "connections" && props.state.connections.length !== 1) throw new Error("Start and Runs require exactly one server.");
  const shared = sharing && props.state.connections.find((connection) => connection.name === sharing.connection)?.runs.find((run) => run.id === sharing.runId);
  const shareAnchor = () => {
    const button = [...main.current?.querySelectorAll<HTMLElement>("[data-share-run]") ?? []]
      .find((element) => element.dataset.shareRun === sharing?.runId);
    if (button) return button;
    const page = main.current;
    return page && { contextElement: page, getBoundingClientRect: () => {
      const bounds = page.getBoundingClientRect();
      return new DOMRect(bounds.x, bounds.y, bounds.width, 0);
    } };
  };
  return <main data-page={page} className="h-full min-w-0 overflow-y-auto p-3 pt-6" ref={main} tabIndex={-1}>
    <div className="@container/panel mx-auto w-full max-w-[1280px] min-w-0">
      {page === "connections" ? <ConnectionsPage {...props} /> : page === "runs" ? <RunsPage key={props.state.connections[0]!.name} {...props} /> : <StartPage {...props} />}
    </div>
    {sharing && <SharePanel anchor={shareAnchor} id="run-sharing-dropdown" key={`${sharing.connection}\u0000${sharing.runId}`} onOpenChange={(open) => { if (!open) props.send({ action: "closeSharing" }); }}
      onSave={(next) => props.send({ action: "share", name: sharing.connection, runId: sharing.runId, sharing: next })} runTitle={shared?.title} sharing={sharing} />}
  </main>;
}
