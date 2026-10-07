import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeSettings } from "../src/ThemeSettings";
import { DockToolsContext, DockWorkspace } from "../src/run-panel/DockWorkspace";
import { createBrowserHost, RunPanelHostProvider } from "../src/run-panel/host";
import type { RunApp } from "../src/run-apps";
import { initializePalette } from "../src/palette";
import { initializeTheme } from "../src/theme";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger } from "../src/ui";
import { initializeZoom, getZoomStore } from "../src/zoom";
import { AccessContext, useAccess } from "../src/AccessContext";
import { SettingsModal } from "../src/SettingsModal";
import { PluginRegistry } from "../src/PluginRegistry";
import { HeaderDropdown } from "../src/ui/HeaderDropdown";
import { Button } from "../src/ui";
import "../src/ui/tailwind.css";

initializeTheme(window);
initializePalette(window);
initializeZoom(window);
const page = new URLSearchParams(location.search).get("page");
const apps: readonly RunApp[] = [{ runId: "zoomed", definition: { id: "notes", title: "Notes" }, Element: () => <input aria-label="App draft" />, layoutKey: "notes" }];
const session = { session: { id: "zoomed", title: "zoomed", updatedAt: 0 }, connected: true, runView: {}, messages: [], pluginEvents: [], running: false, send: async () => {}, start: async () => {} };
const navigation = { activeTabId: "", openTab: () => {}, revealEntity: () => false, selectionFor: () => undefined };
const workspace = <div className="flex h-full flex-col">
  <div className="flex justify-center gap-6 p-4">
    <Popover><PopoverTrigger>Open popover</PopoverTrigger><PopoverContent>Popover content</PopoverContent></Popover>
    <DropdownMenu><DropdownMenuTrigger>Open menu</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>First</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
  </div>
  <div className="flex min-h-0 flex-1">
    <DockToolsContext.Provider value={{ tabs: [], pendingTabIds: [] }}>
      <DockWorkspace apps={apps} chat={<textarea aria-label="Chat draft" className="h-full" />} navigation={navigation} session={session} />
    </DockToolsContext.Provider>
  </div>
</div>;
const host = { ...createBrowserHost(window), kind: page === "vscode-settings" ? "vscode" as const : "browser" as const };
const registry = new PluginRegistry({ brand: { title: "Example" }, product: { id: "example", title: "Example" }, plugins: [], startEntries: [] });
function Overlays() {
  const access = useAccess();
  const [settings, setSettings] = useState(false);
  const [records, setRecords] = useState(false);
  Reflect.set(window, "overlayZoom", (value: number) => getZoomStore().setZoom(value as Parameters<ReturnType<typeof getZoomStore>["setZoom"]>[0]));
  return <AccessContext.Provider value={{ ...access, can: right => right !== "settings.read" && access.can(right) }}><div className="flex h-full flex-col">
    <header className="flex h-14 items-center justify-end gap-2 px-4">
      <Button onClick={() => setSettings(true)}>Open settings</Button>
      <HeaderDropdown label="Records" onOpenChange={setRecords} open={records} trigger={<Button>Open records</Button>}>
        {Array.from({ length: 80 }, (_, index) => <p key={index}>Record {index + 1}</p>)}
      </HeaderDropdown>
    </header>
    {settings && <SettingsModal onClose={() => setSettings(false)} registry={registry} />}
  </div></AccessContext.Provider>;
}
createRoot(document.getElementById("root")!).render(page === null ? workspace : <RunPanelHostProvider value={host}>{page === "overlays" ? <Overlays /> : <ThemeSettings />}</RunPanelHostProvider>);
