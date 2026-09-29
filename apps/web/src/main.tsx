// Foreign classes of highlight.js and react-diff-view; here instead of in the components that mini-apps also bundle.
import "./highlighting.css";
import "./diff-view.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "./ui";
import { App } from "./App";
import { AccessGate, AccessScreen } from "./AccessContext";
import { QuasselHost } from "./chat/QuasselHost";
import { initializeTheme } from "./theme";
import { installHostModules } from "./host-modules";

installHostModules();
const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing");

const reactRoot = createRoot(root);
try {
  const theme = initializeTheme(window);
  import.meta.hot?.dispose(() => theme.dispose());
  reactRoot.render(
    <StrictMode>
      <QuasselHost><AccessGate><App /></AccessGate></QuasselHost>
    </StrictMode>,
  );
} catch (cause) {
  reactRoot.render(<AccessScreen>
    <h1 className="my-3 text-[1.5rem]">The view could not be loaded</h1>
    <p className="mb-6 leading-normal" role="alert">{cause instanceof Error ? cause.message : String(cause)}</p>
    <Button onClick={() => window.location.reload()} variant="outline">Reload</Button>
  </AccessScreen>);
}
