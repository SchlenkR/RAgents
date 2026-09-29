import React from "react";
import { createRoot } from "react-dom/client";
import { context, useAppState } from "@ragents/client";
import * as UI from "@ragents/client/ui";

const App = () => {
  const state = useAppState();
  const notes = state.notes ?? [];
  const [status, setStatus] = React.useState("Run scripts add their notes here.");

  const clear = async (): Promise<void> => {
    const answer = await context.capabilities.call("clear", {});
    setStatus(`Cleared ${answer.cleared} ${answer.cleared === 1 ? "note" : "notes"}.`);
  };

  return (
    <UI.AppLayout title="Notebook" description={<>{notes.length} {notes.length === 1 ? "note" : "notes"}</>}>
      <UI.Stack>
        <p className="text-muted-foreground" role="status">{status}</p>
        <ul className="border-t border-border">
          {notes.map((note, index) => <li className="min-h-8 border-b border-border-soft py-1.5 [overflow-wrap:anywhere]" key={index}>{note}</li>)}
        </ul>
        <UI.Button disabled={notes.length === 0} onClick={() => void clear()} variant="outline">Clear</UI.Button>
      </UI.Stack>
    </UI.AppLayout>
  );
};

const root = document.getElementById("root");
if (!root) throw new Error("The #root element is missing.");
createRoot(root).render(<App />);
