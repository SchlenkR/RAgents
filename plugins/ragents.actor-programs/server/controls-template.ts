import type { ActorProgramTemplate } from "./templates";

export const controlsTemplate: ActorProgramTemplate = {
  id: "controls",
  title: "Try UI controls",
  description: "Local demo with form, table, files, tasks, flow diagram, SVG connections, messages, document, and diff without function calls.",
  ragents: {
    title: "Try UI controls",
    description: "A local demo of the available mini-app controls. Values and files stay in this view.",
    views: [{ id: "main", client: "src/client.tsx" }],
  },
  files: {
    "src/client.tsx": `import React from "react";
import { createRoot } from "react-dom/client";
import * as UI from "@ragents/client/ui";

type FormValues = Parameters<typeof UI.Form>[0]["values"];
type Row = { id: string; name: string; count: number };
const rows: Row[] = [
  { id: "analysis", name: "Analysis", count: 12 },
  { id: "review", name: "Review", count: 4 },
  { id: "notes", name: "Documentation", count: 8 },
];

const App = () => {
  const [values, setValues] = React.useState<FormValues>({ title: "Review results", notes: "", count: 3, mode: "review", approved: false });
  const [selected, setSelected] = React.useState<string[]>([]);
  const [files, setFiles] = React.useState<File[]>([]);
  const [result, setResult] = React.useState("No form values applied yet.");
  const [messages, setMessages] = React.useState<Parameters<typeof UI.MessageList>[0]["messages"]>([
    { key: "editorial", sender: "Editorial", text: "The notice should stay **short and clear**." },
    { key: "review", sender: "Text review", text: "Opening hours and the repair notice are kept." },
  ]);
  const [done, setDone] = React.useState(false);
  return <UI.AppLayout title="Try UI controls" description="Local demo: no agents, uploads, or server actions. Values and file selection stay only in this view and are reset on reload.">
    <UI.Stack gap="large">
      <UI.Form title="Form" fields={[
        { id: "title", label: "Task", type: "text", placeholder: "What should be worked on?", required: true },
        { id: "notes", label: "Notes", type: "textarea", rows: 3, placeholder: "What should be taken into account while working on it?", hint: "Multi-line text stays aligned in the form." },
        { id: "count", label: "Count", type: "number", placeholder: "Number of results", hint: "1 to 10 results.", required: true, min: 1, max: 10 },
        { id: "mode", label: "Mode", type: "select", options: [{ value: "review", label: "Review" }, { value: "draft", label: "Draft" }] },
        { id: "approved", label: "Selection confirmed", type: "checkbox", required: true },
      ]} values={values} onChange={setValues} onSubmit={async (next) => { setResult(JSON.stringify(next, null, 2)); }} submitLabel="Show values locally" />
      <UI.Stack gap="small">
        <UI.DataTable<Row> id="controls-demo-table" title="Data table" rows={rows} rowKey={(row) => row.id} filterable
          selectedKeys={selected} onSelectionChange={setSelected}
          columns={[{ id: "name", label: "Work", value: (row) => row.name, sortable: true, width: 240, minWidth: 100 }, { id: "count", label: "Results", value: (row) => row.count, sortable: true, width: 120, minWidth: 80 }]}
          actions={[{ id: "select", label: "Select", onClick: (row) => { setSelected([row.id]); } }]} />
        <p aria-live="polite">{selected.length} rows selected</p>
      </UI.Stack>
      <UI.FilePicker label="Local file selection" files={files} onChange={setFiles} maxFiles={5} maxBytes={10 * 1024 * 1024} />
      <UI.Stack gap="small">
        <UI.TaskProgress title="Example tasks" tasks={[
          { id: "read", label: "Read documents", status: "done" },
          { id: "review", label: "Review results", status: done ? "done" : "pending", description: "Local example status, no running actor." },
        ]} />
        <UI.Stack direction="row"><UI.Button onClick={() => setDone((current) => !current)}>Toggle example status</UI.Button></UI.Stack>
      </UI.Stack>
      <UI.Stack gap="small">
        <h2>Flow diagram</h2>
        <p>The diagram gets its state from the same data as the task list.</p>
        <UI.FlowDiagram label={done ? "Intake, review done, result ready" : "Intake, review running, result pending"}
          nodes={[
            { id: "input", label: "Intake", detail: "Documents are available", status: "done", kind: "service" },
            { id: "check", label: "Review", detail: done ? "Review completed" : "Documents are being reviewed", status: done ? "done" : "active", kind: "agent" },
            { id: "result", label: "Result", detail: done ? "Result ready" : "Waiting for the review", status: done ? "done" : "pending", kind: "actor" },
          ]}
          edges={[{ source: "input", target: "check" }, { source: "check", target: "result" }]} />
      </UI.Stack>
      <UI.Stack gap="small">
        <h2>SVG connections</h2>
        <p>SvgEdge draws the edges. Nodes, labels, and positions are in the code of this view.</p>
        <svg viewBox="0 0 360 160" role="img" aria-label={done ? "Intake done, review completed, result ready" : "Intake done, review running, result open"}
          className="block h-auto w-full text-[13px]">
          <UI.SvgEdge d="M112 42 L144 42" tone={done ? "success" : "warning"} active={!done} />
          <UI.SvgEdge d="M252 42 C320 42 320 118 252 118" arrow={done ? "end" : "none"} tone={done ? "success" : "neutral"} lineStyle={done ? "solid" : "dashed"} />
          <UI.SvgEdge d="M144 118 C64 118 64 96 64 72" arrow="both" tone="accent" />
          {[{ x: 8, y: 12, label: "Intake", status: "Done" },
            { x: 148, y: 12, label: "Review", status: done ? "Done" : "Running" },
            { x: 148, y: 88, label: "Result", status: done ? "Ready" : "Open" }].map((node) => <g key={node.label}>
              <rect x={node.x} y={node.y} width="104" height="56" rx="8" className="fill-background stroke-border-strong" />
              <text x={node.x + 52} y={node.y + 23} textAnchor="middle" className="fill-foreground font-semibold">{node.label}</text>
              <text x={node.x + 52} y={node.y + 42} textAnchor="middle" className="fill-muted-foreground text-[11px]">{node.status}</text>
            </g>)}
        </svg>
      </UI.Stack>
      <UI.Stack gap="small">
        <UI.MessageList messages={messages} label="Local editorial notes" />
        <UI.Stack direction="row"><UI.Button onClick={() => setMessages((current) => [...current, {
          key: "note-" + current.length, sender: current.length % 2 ? "Text review" : "Editorial",
          text: "Local example note " + (current.length - 1) + ": This message was just added.",
        }])}>Add local message</UI.Button></UI.Stack>
      </UI.Stack>
      <UI.DocumentViewer title="Local form result" format="text" content={result} />
      <UI.DiffViewer title="Example change" patch={"--- a/result.txt\\n+++ b/result.txt\\n@@ -1 +1 @@\\n-Status: open\\n+Status: reviewed"} />
    </UI.Stack>
  </UI.AppLayout>;
};

const root = document.getElementById("root");
if (!root) throw new Error("The #root element is missing.");
createRoot(root).render(<App />);
`,
  },
};
