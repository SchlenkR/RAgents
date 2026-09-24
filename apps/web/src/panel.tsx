import "./ui/tailwind.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PanelPage } from "./panel/PanelPage";
import { isPanelStateMessage, type PanelAction, type PanelState } from "./panel/contract";
import { initializeTheme } from "./theme";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const root = document.getElementById("root");
const embedded = document.getElementById("state");
if (!root || !embedded?.textContent) throw new Error("Root-Element oder eingebetteter Zustand fehlt");

const vscode = acquireVsCodeApi();
const initial = JSON.parse(embedded.textContent) as PanelState;
const theme = initializeTheme(window);

function App() {
  const [state, setState] = useState(initial);
  useEffect(() => {
    const listener = (event: MessageEvent) => { if (isPanelStateMessage(event.data)) setState(event.data.state); };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  useEffect(() => theme.setPreference(state.theme), [state.theme]);
  const send = (action: PanelAction) => vscode.postMessage({ type: "ragents.panel", ...action });
  return <PanelPage send={send} state={state} />;
}

createRoot(root).render(<StrictMode><App /></StrictMode>);
