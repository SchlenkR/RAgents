import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { SessionContext } from "../src/PluginRegistry";
import { ThemeSettings } from "../src/ThemeSettings";
import { PanelActivity } from "../src/run-panel/PanelActivity";
import { initializeAppearance } from "../src/appearance";
import { createVsCodeHost, RunPanelHostProvider } from "../src/run-panel/host";
import { bindHostAppearance } from "../src/run-panel/host-appearance";
import { parseRunPanelLocation } from "../src/run-panel/run-panel-location";
import { createEditorSystemScheme, initializeTheme } from "../src/theme";
import { ActorViewFrame } from "../../../plugins/ragents.actor-programs/web/ActorViewFrame";
import type { RunApp } from "../../../plugins/ragents.actor-programs/web/api";
import "../src/ui/tailwind.css";

const editor = createEditorSystemScheme("dark");
const store = initializeTheme(window, editor);
initializeAppearance(window);
const host = createVsCodeHost(window);
bindHostAppearance({ host, location: parseRunPanelLocation("?host=vscode"), theme: store, editor });
const app: RunApp = {
  id: "notes--main", actorId: "worker", actorHandle: "worker", title: "Notes", revision: "installed",
  actions: [], state: { version: 1, revision: 1, values: { phase: "ready" } }, invocations: [],
};
const session = { session: { id: "density-run" } } as SessionContext;
const unexpectedRequest = async () => { throw new Error("The neutral notes view only loads its frame."); };
const api: Parameters<typeof ActorViewFrame>[0]["api"] = {
  frameUrl: () => "/app.html", list: unexpectedRequest, source: unexpectedRequest,
  invoke: unexpectedRequest, invocation: unexpectedRequest, invokeFunction: unexpectedRequest, functionInvocation: unexpectedRequest,
};

declare global {
  interface Window {
    densityFrameFixture: { store: typeof store; setActive: (active: boolean) => void };
  }
}

function Fixture() {
  const [active, setActive] = useState(true);
  window.densityFrameFixture = { store, setActive };
  return <RunPanelHostProvider value={host}><main className="grid h-screen grid-cols-2 gap-6 bg-app p-6">
    <ThemeSettings />
    <section aria-label="Installed notes" className="flex min-h-0 min-w-0">
      <PanelActivity active={active}><ActorViewFrame api={api} app={app} runId="density-run" session={session}
        invoke={async () => { throw new Error("The neutral notes view has no actions."); }} /></PanelActivity>
    </section>
  </main></RunPanelHostProvider>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
