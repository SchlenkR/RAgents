import React from "react";
import { createRoot } from "react-dom/client";
import { context, useAppState } from "@ragents/client";
import { LearningAfternoonView } from "./view.js";
import { initialState } from "./state.js";

function App() {
  const state = useAppState();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const start = async () => {
    setPending(true);
    setError(undefined);
    try {
      await context.capabilities.call("start", {});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };
  return <LearningAfternoonView state={state.board ?? initialState} onStart={state.board ? start : undefined} pending={pending} error={error} />;
}

const root = document.getElementById("root");
if (!root) throw new Error("Das Wurzelelement #root fehlt.");
createRoot(root).render(<App />);
