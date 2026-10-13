import { useLayoutEffect, useRef } from "react";
import { ConnectionsPage } from "./ConnectionsPage";
import type { PanelPageProps } from "./page-props";
import { RunsPage } from "./RunsPage";
import { SharePanel } from "./SharePanel";
import { StartPage } from "./StartPage";

/** The panel without an open run: the Start dashboard uses the full width, Runs and Server one centered column; every page starts at the same height. */
export function PanelPage(props: PanelPageProps) {
  const main = useRef<HTMLElement>(null);
  const scrolled = useRef(0);
  // Hiding the page behind an open run drops its scroll position; showing it again restores the last one.
  useLayoutEffect(() => {
    if (main.current && scrolled.current > 0) main.current.scrollTop = scrolled.current;
  }, []);
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
  return <main data-page={page} className="relative h-full min-w-0 overflow-y-auto px-3 pb-12 [scrollbar-gutter:stable]" ref={main} tabIndex={-1}
    onScroll={(event) => { if (event.currentTarget.clientHeight > 0) scrolled.current = event.currentTarget.scrollTop; }}>
    <div className={`@container/panel mx-auto w-full min-w-0 ${page === "start" ? "pt-3 lg:px-8" : "max-w-[1280px] pt-6 lg:pt-8"}`}>
      {page === "connections" ? <ConnectionsPage {...props} /> : page === "runs" ? <RunsPage key={props.state.connections[0]!.name} {...props} /> : <StartPage {...props} />}
    </div>
    {sharing && <SharePanel anchor={shareAnchor} id="run-sharing-dropdown" key={`${sharing.connection}\u0000${sharing.runId}`} onOpenChange={(open) => { if (!open) props.send({ action: "closeSharing" }); }}
      onSave={(next) => props.send({ action: "share", name: sharing.connection, runId: sharing.runId, sharing: next })} runTitle={shared?.title} sharing={sharing} />}
  </main>;
}
