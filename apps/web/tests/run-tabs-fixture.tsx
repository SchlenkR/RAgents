import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { OrchestrationRunPanel } from "../../../plugins/ragents.orchestration/web/run-panel/RunPanel";
import { unrestrictedAccess } from "../../../packages/ragents/src/access";
import { AccessContext } from "../src/AccessContext";
import { createBrowserHost, RunPanelHostProvider } from "../src/run-panel/host";
import type { SurfaceElementContext, SurfaceElementDefinition } from "../src/PluginRegistry";
import "../src/ui/tailwind.css";

const mounts: Record<string, number> = {};
function MiniApp({ definition }: SurfaceElementContext) {
  useEffect(() => { mounts[definition.id] = (mounts[definition.id] ?? 0) + 1; }, [definition.id]);
  return <input aria-label={`${definition.title} draft`} />;
}
const navigation = { activeTabId: "", openTab() {}, revealEntity: () => false, selectionFor: () => undefined };
const host = createBrowserHost(window);
const initial = [{ id: "notes", title: "Notes" }, { id: "counter", title: "Counter" }];
function Fixture() {
  const [run, setRun] = useState("first");
  const [apps, setApps] = useState<readonly SurfaceElementDefinition[]>(initial);
  window.tabsFixture = { mounts, setApps, setRun };
  return <AccessContext.Provider value={{ ...unrestrictedAccess, logout: async () => {} }}><RunPanelHostProvider value={host}>
    <OrchestrationRunPanel cardSections={[]} navigation={navigation} statusContainer={null} tabIds={[]} toolbarContainer={null}
      session={{ session: { id: run, title: run, updatedAt: 0 }, connected: true, messages: [], pluginEvents: [], running: false, send: async () => {}, start: async () => {} }}
      renderChat={() => <textarea aria-label="Chat draft" />}
      surfaceElements={[{ id: "apps", order: 0, select: () => apps, Element: MiniApp }]} />
  </RunPanelHostProvider></AccessContext.Provider>;
}
declare global {
  interface Window { tabsFixture: { mounts: typeof mounts; setApps: (apps: readonly SurfaceElementDefinition[]) => void; setRun: (run: string) => void } }
}
createRoot(document.getElementById("root")!).render(<Fixture />);
