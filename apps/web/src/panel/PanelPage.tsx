import { ConnectionsPage } from "./ConnectionsPage";
import type { PanelPageProps } from "./page-props";
import { RunsPage } from "./RunsPage";
import { StartPage } from "./StartPage";

/** The panel without an open run: Start, Runs, or Server in one centered column that starts at the same height on every page; the run itself lives in the run panel. */
export function PanelPage(props: PanelPageProps) {
  const page = props.state.page;
  return <main data-page={page} className="h-full min-w-0 overflow-y-auto p-3 pt-6">
    <div className="@container/panel mx-auto w-full max-w-[1280px] min-w-0">
      {page === "connections" ? <ConnectionsPage {...props} /> : page === "runs" ? <RunsPage key={props.state.runsConnection ?? ""} {...props} /> : <StartPage {...props} />}
    </div>
  </main>;
}
