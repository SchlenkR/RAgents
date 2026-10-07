import { createRoot } from "react-dom/client";
import { ThemeSettings } from "../src/ThemeSettings";
import { DockToolsContext, DockWorkspace } from "../src/run-panel/DockWorkspace";
import { createBrowserHost, RunPanelHostProvider } from "../src/run-panel/host";
import type { RunApp } from "../src/run-apps";
import { initializePalette } from "../src/palette";
import { initializeTheme } from "../src/theme";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger } from "../src/ui";
import { initializeZoom } from "../src/zoom";
import "../src/ui/tailwind.css";

initializeTheme(window);
initializePalette(window);
initializeZoom(window);
const page = new URLSearchParams(location.search).get("page");
const apps: readonly RunApp[] = [{ runId: "zoomed", definition: { id: "notes", title: "Notes" }, Element: () => <input aria-label="App draft" /> }];
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
createRoot(document.getElementById("root")!).render(page === null ? workspace : <RunPanelHostProvider value={host}><ThemeSettings /></RunPanelHostProvider>);
