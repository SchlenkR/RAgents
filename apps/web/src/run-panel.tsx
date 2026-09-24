// Fremde Klassen von highlight.js und react-diff-view; hier statt in den Komponenten, die auch Mini-Apps bündeln.
import "./highlighting.css";
import "./diff-view.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "./ui";
import { AccessGate, AccessScreen } from "./AccessContext";
import { installAccessToken } from "./access-token";
import { installClipboardBridge } from "./run-panel/clipboard";
import { installKeyboardBridge } from "./run-panel/keyboard";
import { RunPanelApp, HostLogin } from "./run-panel/RunPanelApp";
import { parseRunPanelLocation } from "./run-panel/run-panel-location";
import { RunPanelHostProvider, createRunPanelHost } from "./run-panel/host";
import { PageOpenerProvider } from "./page-opener";
import { initializeTheme } from "./theme";
import { installHostModules } from "./host-modules";

installHostModules();
const root = document.getElementById("root");
if (!root) throw new Error("Root-Element fehlt");

const reactRoot = createRoot(root);
try {
  const location = parseRunPanelLocation(window.location.search);
  if (location.access !== undefined) installAccessToken(location.access);
  const host = createRunPanelHost(location.host, window);
  if (location.host === "vscode") {
    const disposeClipboard = installClipboardBridge(window);
    const disposeKeyboard = installKeyboardBridge(window);
    import.meta.hot?.dispose(() => { disposeKeyboard(); disposeClipboard(); });
  }
  const theme = initializeTheme(window);
  if (location.theme !== undefined) theme.setPreference(location.theme);
  host.onCommand((message) => { if (message.type === "theme") theme.setPreference(message.theme); });
  import.meta.hot?.dispose(() => theme.dispose());
  reactRoot.render(
    <StrictMode>
      <RunPanelHostProvider value={host}>
        <PageOpenerProvider value={location.host === "vscode" ? { open: host.openPage } : undefined}>
          <AccessGate Login={location.host === "vscode" ? HostLogin : undefined}><RunPanelApp location={location} /></AccessGate>
        </PageOpenerProvider>
      </RunPanelHostProvider>
    </StrictMode>,
  );
} catch (cause) {
  reactRoot.render(<AccessScreen>
    <h1 className="my-3 text-[1.5rem]">Das RAgents-Panel konnte nicht geladen werden</h1>
    <p className="mb-6 leading-normal" role="alert">{cause instanceof Error ? cause.message : String(cause)}</p>
    <Button onClick={() => window.location.reload()} variant="outline">Erneut laden</Button>
  </AccessScreen>);
}
