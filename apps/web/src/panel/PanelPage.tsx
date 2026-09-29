import { ConnectionsPage } from "./ConnectionsPage";
import type { PanelPageProps } from "./page-props";
import { RunsPage } from "./RunsPage";
import { StartPage } from "./StartPage";

/** The panel without an open run: Start, Runs, or Server; the run itself lives in the run panel. */
export function PanelPage(props: PanelPageProps) {
  const page = props.state.page;
  return <main className="h-full overflow-y-auto p-3">
    {page === "connections" ? <ConnectionsPage {...props} /> : page === "runs" ? <RunsPage key={props.state.runsConnection ?? ""} {...props} /> : <StartPage {...props} />}
  </main>;
}
