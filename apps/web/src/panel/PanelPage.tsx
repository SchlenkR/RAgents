import { EnvironmentsPage } from "./EnvironmentsPage";
import type { PanelPageProps } from "./page-props";
import { RunsPage } from "./RunsPage";
import { StartPage } from "./StartPage";

/** Das Panel ohne geöffneten Run: Start, Runs oder Umgebungen; der Run selbst liegt im Run-Panel. */
export function PanelPage(props: PanelPageProps) {
  const page = props.state.page;
  return <main className="h-dvh overflow-y-auto p-3">
    {page === "environments" ? <EnvironmentsPage {...props} /> : page === "runs" ? <RunsPage key={props.state.runsEnvironment ?? ""} {...props} /> : <StartPage {...props} />}
  </main>;
}
