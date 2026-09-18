import "./ui/tailwind.css";
// Fremde Klassen von highlight.js und react-diff-view; hier statt in den Komponenten, die auch Mini-Apps bündeln.
import "./highlighting.css";
import "./diff-view.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "./ui";
import { App } from "./App";
import { AccessGate, AccessScreen } from "./AccessContext";
import { initializeTheme } from "./theme";

const root = document.getElementById("root");
if (!root) throw new Error("Root-Element fehlt");

const reactRoot = createRoot(root);
try {
  const theme = initializeTheme(window);
  import.meta.hot?.dispose(() => theme.dispose());
  reactRoot.render(
    <StrictMode>
      <AccessGate><App /></AccessGate>
    </StrictMode>,
  );
} catch (cause) {
  reactRoot.render(<AccessScreen>
    <h1 className="my-3 text-[1.5rem]">Darstellung konnte nicht geladen werden</h1>
    <p className="mb-6 leading-normal" role="alert">{cause instanceof Error ? cause.message : String(cause)}</p>
    <Button onClick={() => window.location.reload()} variant="outline">Erneut laden</Button>
  </AccessScreen>);
}
