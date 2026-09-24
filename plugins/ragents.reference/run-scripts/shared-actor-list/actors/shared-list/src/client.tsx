import React from "react";
import { createRoot } from "react-dom/client";
import { context, useAppState } from "@ragents/client";
import * as UI from "@ragents/client/ui";

type FormValues = Parameters<typeof UI.Form>[0]["values"];

const App = () => {
  const state = useAppState();
  const [values, setValues] = React.useState<FormValues>({ text: "" });
  const [status, setStatus] = React.useState("Ready");
  const entries = state.entries ?? [];

  const append = async (next: FormValues): Promise<void> => {
    const answer = await context.capabilities.call("append", { text: String(next.text ?? "") });
    setValues({ text: "" });
    setStatus(`Added: ${answer.text}`);
  };

  return (
    <UI.AppLayout title="Shared list" description={<>{entries.length} {entries.length === 1 ? "item" : "items"}</>}>
      <UI.Grid>
        <UI.Form fields={[
          { id: "text", label: "New item", type: "textarea", placeholder: "Enter text" },
        ]} values={values} onChange={setValues} onSubmit={append} submitLabel="Add" />
        <UI.Stack>
          <p className="text-muted-foreground" role="status">{status}</p>
          <ul className="border-t border-border">
            {entries.map((entry, index) => <li className="min-h-8 border-b border-border-soft py-1.5 [overflow-wrap:anywhere]" key={index}>{entry}</li>)}
          </ul>
        </UI.Stack>
      </UI.Grid>
    </UI.AppLayout>
  );
};

const root = document.getElementById("root");
if (!root) throw new Error("The #root element is missing.");
createRoot(root).render(<App />);
