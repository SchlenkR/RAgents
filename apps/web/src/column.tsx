import "./ui/tailwind.css";
// Fremde Klassen von highlight.js und react-diff-view; hier statt in den Komponenten, die auch Mini-Apps bündeln.
import "./highlighting.css";
import "./diff-view.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "./ui";
import { AccessGate, AccessScreen } from "./AccessContext";
import { installAccessToken } from "./access-token";
import { ColumnApp, HostLogin } from "./column/ColumnApp";
import { parseColumnLocation } from "./column/column-location";
import { ColumnHostProvider, createColumnHost } from "./column/host";
import { PageOpenerProvider } from "./page-opener";
import { initializeTheme } from "./theme";

const root = document.getElementById("root");
if (!root) throw new Error("Root-Element fehlt");

const reactRoot = createRoot(root);
try {
  const location = parseColumnLocation(window.location.search);
  if (location.access !== undefined) installAccessToken(location.access);
  const host = createColumnHost(location.host, window);
  const theme = initializeTheme(window);
  if (location.theme !== undefined) theme.setPreference(location.theme);
  host.onCommand((message) => { if (message.type === "theme") theme.setPreference(message.theme); });
  import.meta.hot?.dispose(() => theme.dispose());
  reactRoot.render(
    <StrictMode>
      <ColumnHostProvider value={host}>
        <PageOpenerProvider value={location.host === "vscode" ? { open: host.openPage } : undefined}>
          <AccessGate Login={location.host === "vscode" ? HostLogin : undefined}><ColumnApp location={location} /></AccessGate>
        </PageOpenerProvider>
      </ColumnHostProvider>
    </StrictMode>,
  );
} catch (cause) {
  reactRoot.render(<AccessScreen>
    <h1 className="my-3 text-[1.5rem]">Die Spalte konnte nicht geladen werden</h1>
    <p className="mb-6 leading-normal" role="alert">{cause instanceof Error ? cause.message : String(cause)}</p>
    <Button onClick={() => window.location.reload()} variant="outline">Erneut laden</Button>
  </AccessScreen>);
}
