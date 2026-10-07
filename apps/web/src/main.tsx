// Foreign classes of highlight.js and react-diff-view; here instead of in the components that mini-apps also bundle.
import "./highlighting.css";
import "./diff-view.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "./ui";
import { AccessGate, AccessScreen } from "./AccessContext";
import { QuasselHost } from "./chat/QuasselHost";
import { installAccessToken } from "./access-token";
import { installRunPanelInputBridge } from "./run-panel/input-bridge";
import { RunPanelApp, HostLogin } from "./run-panel/RunPanelApp";
import { parseRunPanelLocation } from "./run-panel/run-panel-location";
import { RunPanelHostProvider, createRunPanelHost } from "./run-panel/host";
import { PageOpenerProvider } from "./page-opener";
import { initializeTheme } from "./theme";
import { initializeZoom } from "./zoom";
import { installHostModules } from "./host-modules";
import { RenderBoundary } from "./RenderBoundary";

installHostModules();
const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing");

const reactRoot = createRoot(root);
try {
  const location = parseRunPanelLocation(window.location.search);
  document.documentElement.dataset.host = location.host;
  if (location.access !== undefined) installAccessToken(location.access);
  const host = createRunPanelHost(location.host, window);
  if (location.host === "vscode") {
    const disposeInput = installRunPanelInputBridge(window);
    import.meta.hot?.dispose(disposeInput);
  }
  const theme = initializeTheme(window);
  if (location.theme !== undefined) theme.setPreference(location.theme);
  host.onCommand((message) => { if (message.type === "theme") theme.setPreference(message.theme); });
  import.meta.hot?.dispose(() => theme.dispose());
  if (location.host === "browser") {
    const zoom = initializeZoom(window);
    import.meta.hot?.dispose(() => zoom.dispose());
  }
  reactRoot.render(
    <StrictMode>
      <RenderBoundary resetKeys={[location.host]} title="The RAgents panel could not be displayed">
        <QuasselHost>
          <RunPanelHostProvider value={host}>
            <PageOpenerProvider value={location.host === "vscode" ? { open: host.openPage } : undefined}>
              <AccessGate Login={location.host === "vscode" ? HostLogin : undefined}><RunPanelApp location={location} /></AccessGate>
            </PageOpenerProvider>
          </RunPanelHostProvider>
        </QuasselHost>
      </RenderBoundary>
    </StrictMode>,
  );
} catch (cause) {
  reactRoot.render(<AccessScreen>
    <h1 className="my-3 text-[1.5rem]">The RAgents panel could not be loaded</h1>
    <p className="mb-6 leading-normal" role="alert">{cause instanceof Error ? cause.message : String(cause)}</p>
    <Button onClick={() => window.location.reload()} variant="outline">Reload</Button>
  </AccessScreen>);
}
