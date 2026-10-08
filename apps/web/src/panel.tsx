import "./ui/tailwind.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PanelPage } from "./panel/PanelPage";
import { isPanelStateMessage, type PanelAction, type PanelState } from "./panel/contract";
import { applyAppearance, initializeAppearance } from "./appearance";
import { initializeTheme } from "./theme";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const root = document.getElementById("root");
const embedded = document.getElementById("state");
if (!root || !embedded?.textContent) throw new Error("Root element or embedded state is missing");

const vscode = acquireVsCodeApi();
const initial = JSON.parse(embedded.textContent) as PanelState;
document.documentElement.dataset.host = "vscode";
const theme = initializeTheme(window);
initializeAppearance(window);

function App() {
  const [state, setState] = useState(initial);
  useEffect(() => {
    const listener = (event: MessageEvent) => { if (isPanelStateMessage(event.data)) setState(event.data.state); };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  useEffect(() => theme.setPreference(state.theme), [state.theme]);
  const { palette, codeStyle, corners, density } = state.looks ?? {};
  useEffect(() => applyAppearance({ palette, codeStyle, corners, density }), [palette, codeStyle, corners, density]);
  const send = (action: PanelAction) => vscode.postMessage({ type: "ragents.panel", ...action });
  return <PanelPage send={send} state={state} />;
}

createRoot(root).render(<StrictMode><App /></StrictMode>);
