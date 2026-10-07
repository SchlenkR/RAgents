import { createRoot } from "react-dom/client";
import { AppearanceQuickSwitch } from "../src/AppearanceControls";
import { ThemeSettings } from "../src/ThemeSettings";
import { initializeAppearance } from "../src/appearance";
import { createBrowserHost, createVsCodeHost, RunPanelHostProvider } from "../src/run-panel/host";
import { bindHostAppearance } from "../src/run-panel/host-appearance";
import { parseRunPanelLocation } from "../src/run-panel/run-panel-location";
import { createEditorSystemScheme, getThemeStore, initializeTheme } from "../src/theme";
import { initializeZoom } from "../src/zoom";
import "../src/ui/tailwind.css";

const location = parseRunPanelLocation(window.location.search);
const host = location.host === "vscode" ? createVsCodeHost(window) : createBrowserHost(window);
const editor = location.host === "vscode" ? createEditorSystemScheme(location.theme ?? "dark") : undefined;
initializeTheme(window, editor);
initializeAppearance(window);
initializeZoom(window);
bindHostAppearance({ host, location, theme: getThemeStore(), editor });
createRoot(document.getElementById("root")!).render(<RunPanelHostProvider value={host}>
  <header className="flex h-14 items-center justify-end px-4"><AppearanceQuickSwitch /></header>
  <div className="px-4" data-quassel><div data-message="answer"><div><p>Text with <code id="inline">inline code</code> in it.</p></div></div></div>
  <div className="px-4"><div id="cell" style={{ paddingBlock: "var(--grid-cell-y)" }}>Cell</div></div>
  <ThemeSettings />
</RunPanelHostProvider>);
