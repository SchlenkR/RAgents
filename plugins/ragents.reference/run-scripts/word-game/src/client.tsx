import React from "react";
import { createRoot } from "react-dom/client";
import { context, useAppState } from "@ragents/client";
import { WordGameView } from "./view.js";

function App() {
  const state = useAppState();
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string>();
  const start = async () => {
    setBusy(true);
    setActionError(undefined);
    try {
      const result = await context.capabilities.call("start", {});
      if (!result.accepted) throw new Error("Das Spiel ist bereits gestartet oder noch nicht bereit.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return <WordGameView state={state} onStart={start} busy={busy} actionError={actionError} />;
}

const root = document.getElementById("root");
if (!root) throw new Error("Das Wurzelelement #root fehlt.");
createRoot(root).render(<App />);
