import type { ActorProgramTemplate } from "./templates";

export const controlsTemplate: ActorProgramTemplate = {
  id: "controls",
  title: "UI-Controls ausprobieren",
  description: "Lokale Demo mit Formular, Tabelle, Dateien, Aufgaben, Ablaufdiagramm, SVG-Verbindungen, Nachrichten, Dokument und Diff ohne Funktionsaufrufe.",
  files: {
    "package.json": `{
  "name": "controls",
  "private": true,
  "type": "module",
  "ragents": {
    "title": "UI-Controls ausprobieren",
    "description": "Eine lokale Demo der vorhandenen Mini-App-Controls. Werte und Dateien bleiben in dieser Ansicht.",
    "views": [
      {
        "id": "main",
        "client": "src/client.tsx",
        "width": 640,
        "height": 640
      }
    ]
  }
}
`,
    "src/client.tsx": `import React from "react";
import { createRoot } from "react-dom/client";
import * as UI from "@ragents/client/ui";

type FormValues = Parameters<typeof UI.Form>[0]["values"];
type Row = { id: string; name: string; count: number };
const rows: Row[] = [
  { id: "analysis", name: "Analyse", count: 12 },
  { id: "review", name: "Review", count: 4 },
  { id: "notes", name: "Dokumentation", count: 8 },
];

const App = () => {
  const [values, setValues] = React.useState<FormValues>({ title: "Ergebnisse prüfen", notes: "", count: 3, mode: "review", approved: false });
  const [selected, setSelected] = React.useState<string[]>([]);
  const [files, setFiles] = React.useState<File[]>([]);
  const [result, setResult] = React.useState("Noch keine Formularwerte übernommen.");
  const [messages, setMessages] = React.useState<Parameters<typeof UI.MessageList>[0]["messages"]>([
    { key: "editorial", sender: "Redaktion", text: "Der Hinweis soll **kurz und verständlich** bleiben." },
    { key: "review", sender: "Textprüfung", text: "Öffnungszeiten und Reparaturhinweis bleiben erhalten." },
  ]);
  const [done, setDone] = React.useState(false);
  return <UI.AppLayout title="UI-Controls ausprobieren" description="Lokale Demo: keine Agenten, Uploads oder Serveraktionen. Werte und Dateiauswahl bleiben nur in dieser Ansicht und werden beim Neuladen zurückgesetzt.">
    <UI.Stack gap="large">
      <UI.Form title="Formular" fields={[
        { id: "title", label: "Auftrag", type: "text", placeholder: "Was soll bearbeitet werden?", required: true },
        { id: "notes", label: "Hinweise", type: "textarea", rows: 3, placeholder: "Was soll bei der Bearbeitung berücksichtigt werden?", hint: "Mehrzeiliger Text bleibt im Formular ausgerichtet." },
        { id: "count", label: "Anzahl", type: "number", placeholder: "Anzahl der Ergebnisse", hint: "1 bis 10 Ergebnisse.", required: true, min: 1, max: 10 },
        { id: "mode", label: "Modus", type: "select", options: [{ value: "review", label: "Prüfen" }, { value: "draft", label: "Entwerfen" }] },
        { id: "approved", label: "Auswahl bestätigt", type: "checkbox", required: true },
      ]} values={values} onChange={setValues} onSubmit={async (next) => { setResult(JSON.stringify(next, null, 2)); }} submitLabel="Werte lokal anzeigen" />
      <UI.Stack gap="small">
        <UI.DataTable<Row> title="Datentabelle" rows={rows} rowKey={(row) => row.id} filterable
          selectedKeys={selected} onSelectionChange={setSelected}
          columns={[{ id: "name", label: "Arbeit", value: (row) => row.name, sortable: true }, { id: "count", label: "Ergebnisse", value: (row) => row.count, sortable: true }]}
          actions={[{ id: "select", label: "Auswählen", onClick: (row) => { setSelected([row.id]); } }]} />
        <p aria-live="polite">{selected.length} Zeilen ausgewählt</p>
      </UI.Stack>
      <UI.FilePicker label="Lokale Dateiauswahl" files={files} onChange={setFiles} maxFiles={5} maxBytes={10 * 1024 * 1024} />
      <UI.Stack gap="small">
        <UI.TaskProgress title="Beispielaufgaben" tasks={[
          { id: "read", label: "Unterlagen lesen", status: "done" },
          { id: "review", label: "Ergebnisse prüfen", status: done ? "done" : "pending", description: "Lokaler Beispielstatus, kein laufender Actor." },
        ]} />
        <UI.Stack direction="row"><UI.Button onClick={() => setDone((current) => !current)}>Beispielstatus umschalten</UI.Button></UI.Stack>
      </UI.Stack>
      <UI.Stack gap="small">
        <h2>Ablaufdiagramm</h2>
        <p>Das Diagramm erhält seinen Zustand aus denselben Daten wie die Aufgabenliste.</p>
        <UI.FlowDiagram label={done ? "Eingang, Prüfung fertig, Ergebnis bereit" : "Eingang, Prüfung läuft, Ergebnis ausstehend"}
          nodes={[
            { id: "input", label: "Eingang", detail: "Unterlagen liegen vor", status: "done", kind: "service" },
            { id: "check", label: "Prüfung", detail: done ? "Prüfung abgeschlossen" : "Unterlagen werden geprüft", status: done ? "done" : "active", kind: "agent" },
            { id: "result", label: "Ergebnis", detail: done ? "Ergebnis bereit" : "Wartet auf die Prüfung", status: done ? "done" : "pending", kind: "actor" },
          ]}
          edges={[{ source: "input", target: "check" }, { source: "check", target: "result" }]} />
      </UI.Stack>
      <UI.Stack gap="small">
        <h2>SVG-Verbindungen</h2>
        <p>SvgEdge zeichnet die Kanten. Knoten, Beschriftungen und Positionen stehen im Code dieser Ansicht.</p>
        <svg viewBox="0 0 360 160" role="img" aria-label={done ? "Eingang fertig, Prüfung abgeschlossen, Ergebnis bereit" : "Eingang fertig, Prüfung läuft, Ergebnis offen"}
          className="block h-auto w-full text-[13px]">
          <UI.SvgEdge d="M112 42 L144 42" tone={done ? "success" : "warning"} active={!done} />
          <UI.SvgEdge d="M252 42 C320 42 320 118 252 118" arrow={done ? "end" : "none"} tone={done ? "success" : "neutral"} lineStyle={done ? "solid" : "dashed"} />
          <UI.SvgEdge d="M144 118 C64 118 64 96 64 72" arrow="both" tone="accent" />
          {[{ x: 8, y: 12, label: "Eingang", status: "Fertig" },
            { x: 148, y: 12, label: "Prüfung", status: done ? "Fertig" : "Läuft" },
            { x: 148, y: 88, label: "Ergebnis", status: done ? "Bereit" : "Offen" }].map((node) => <g key={node.label}>
              <rect x={node.x} y={node.y} width="104" height="56" rx="8" className="fill-background stroke-border-strong" />
              <text x={node.x + 52} y={node.y + 23} textAnchor="middle" className="fill-foreground font-semibold">{node.label}</text>
              <text x={node.x + 52} y={node.y + 42} textAnchor="middle" className="fill-muted-foreground text-[11px]">{node.status}</text>
            </g>)}
        </svg>
      </UI.Stack>
      <UI.Stack gap="small">
        <UI.MessageList messages={messages} label="Lokale Redaktionsnotizen" />
        <UI.Stack direction="row"><UI.Button onClick={() => setMessages((current) => [...current, {
          key: "note-" + current.length, sender: current.length % 2 ? "Textprüfung" : "Redaktion",
          text: "Lokale Beispielnotiz " + (current.length - 1) + ": Diese Nachricht wurde gerade ergänzt.",
        }])}>Lokale Nachricht ergänzen</UI.Button></UI.Stack>
      </UI.Stack>
      <UI.DocumentViewer title="Lokales Formularergebnis" format="text" content={result} />
      <UI.DiffViewer title="Beispieländerung" patch={"--- a/result.txt\\n+++ b/result.txt\\n@@ -1 +1 @@\\n-Status: offen\\n+Status: geprüft"} />
    </UI.Stack>
  </UI.AppLayout>;
};

const root = document.getElementById("root");
if (!root) throw new Error("Das Wurzelelement #root fehlt.");
createRoot(root).render(<App />);
`,
  },
};
