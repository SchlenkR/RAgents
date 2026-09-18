import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppLayout, Stack, Grid, Chat, ChatInput, ChatMessages, MessageList, Markdown, Form, DataTable, FilePicker, TaskProgress, DocumentViewer, DiffViewer, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger, Toggle, ToggleGroup, ToggleGroupItem, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, ListDetail, SvgEdge, FlowDiagram, WorkflowDiagram } from "../../plugins/ragents.actor-programs/client-ui/index";
import { learningWorkflow } from "../../plugins/ragents.reference/run-scripts/learning-afternoon/src/workflow";
import { ArrowLeftIcon, CheckIcon, SparklesIcon, Trash2Icon, WrenchIcon, XIcon } from "lucide-react";
import type { ChatAttachmentInput, Message, FormValues, ListDetailItem } from "../../plugins/ragents.actor-programs/client-ui/contracts";
import "../../plugins/ragents.actor-programs/client-ui/flow-diagram.css";

const initialMessages: Message[] = [
  { key: "intro", role: "assistant", text: "Dies ist der vorhandene Chat-Baustein. Deine Eingaben bleiben nur in dieser lokalen Demo.", closed: true },
];

const attachmentCapabilities = { input: ["text", "image", "video", "file"], model: "Lokale Demo" };

const localMessage = (key: string, text: string, attachments: ChatAttachmentInput[] = []): Message => ({
  key, role: "user", text, closed: true,
  attachments: attachments.map(({ name, mediaType, data }) => ({
    name, mediaType, size: atob(data).length, url: `data:${mediaType};base64,${data}`,
  })),
});

function ListDetailShowcase() {
  const [selectedId, setSelectedId] = useState("draft");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState("Noch keine Auswahl übernommen.");
  const items: ListDetailItem[] = [
    { id: "draft", title: "Textentwurf", description: "Eine kurze Mitteilung gemeinsam bearbeiten.", group: "In Arbeit", icon: <SparklesIcon size={14} />, meta: "Entwurf", tone: "accent" },
    { id: "review", title: "Inhalt prüfen", description: "Offene Fragen und nächste Schritte festhalten.", group: "In Arbeit", icon: <WrenchIcon size={14} />, meta: "Prüfung", tone: "purple" },
    { id: "result", title: "Ergebnis lesen", description: "Den abgeschlossenen Beispieltext ansehen.", group: "Erledigt", icon: <CheckIcon size={14} />, meta: "Ergebnis", tone: "success" },
  ];
  const visible = items.filter((item) => `${item.title} ${item.description}`.toLocaleLowerCase("de").includes(query.toLocaleLowerCase("de")));
  const selected = visible.find((item) => item.id === selectedId);
  return <section className="reference-ui-example" data-component="ListDetail">
    <h3>Liste mit Detailansicht</h3>
    <p>Die Liste wählt einen Eintrag aus. Erst die Aktion in der Detailansicht übernimmt ihn. Auf schmalen Ansichten führt "Zur Auswahl" zurück zur Liste.</p>
    <div style={{ display: "flex", height: 380, marginTop: 16 }}>
      <ListDetail label="Lokale Beispiele" items={visible} selectedId={selectedId} onSelect={setSelectedId}
        toolbar={<Input aria-label="Beispiele durchsuchen" onChange={(event) => setQuery(event.target.value)} placeholder="Beispiele durchsuchen" type="search" value={query} />}
        detailLabel="Beispiel ansehen" detailHeader={selected && <><h3>{selected.title}</h3><p>{selected.description}</p></>}
        detailFooter={selected && <Button onClick={() => setResult(`Übernommen: ${selected.title}`)}>Auswahl übernehmen</Button>}
        emptyState={<p>Keine Beispiele für diese Suche.</p>}>
        <p>Dies ist eine lokale Detailansicht. Die Auswahl verändert nur diese Demo; es werden keine Agenten oder Abläufe gestartet.</p>
      </ListDetail>
    </div>
    <p aria-live="polite">{result}</p>
  </section>;
}

function LayoutShowcase() {
  const [values, setValues] = useState<FormValues>({ answer: "" });
  const [answer, setAnswer] = useState("");
  return <section data-component="AppLayout Stack Grid" className="reference-ui-example">
    <h3>App-Rahmen, Abstände und responsive Spalten</h3>
    <p>AppLayout setzt Titel und Inhaltsrahmen, Stack ordnet Inhalte mit festen Abständen an. Grid zeigt hier zwei Spalten und wechselt bei wenig Platz auf eine. Diese Formular-Demo verwendet kein eigenes App-CSS.</p>
    <AppLayout title="Balkongestaltung" description="Lokale Demo: Deine Antwort erscheint unverändert daneben. Kein Modell, kein Run und keine Speicherung nach dem Neuladen."
      actions={<Button onClick={() => { setValues({ answer: "" }); setAnswer(""); }} variant="outline">Zurücksetzen</Button>}>
      <Grid>
        <Stack>
          <Stack direction="row" gap="small">
            <span>Eine Beispielfrage</span>
            <span aria-live="polite">{answer ? "Antwort übernommen" : "Antwort offen"}</span>
          </Stack>
          <p>Wie groß ist dein Balkon und in welche Himmelsrichtung zeigt er?</p>
          <Form title="Deine Angaben" fields={[
            { id: "answer", label: "Deine Antwort", type: "textarea", rows: 4, required: true, placeholder: "Zum Beispiel: 4 Quadratmeter, Südbalkon", hint: "Absenden zeigt nur deinen eingegebenen Text." },
          ]} values={values} onChange={setValues} onSubmit={async (next) => { setAnswer(String(next.answer)); }} submitLabel="Antwort lokal anzeigen" />
        </Stack>
        <Stack gap="small">
          <h3>Übernommene Antwort</h3>
          <div aria-live="polite"><DocumentViewer format="text" content={answer || "Noch keine Antwort übernommen."} /></div>
        </Stack>
      </Grid>
    </AppLayout>
  </section>;
}

function ControlsShowcase() {
  const [values, setValues] = useState<FormValues>({ title: "Ergebnisse prüfen", notes: "", count: 3, mode: "review", approved: false });
  const [result, setResult] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [filter, setFilter] = useState("Alle");
  const [view, setView] = useState("list");
  const [tab, setTab] = useState("status");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [diagramDone, setDiagramDone] = useState(false);
  const [flowDone, setFlowDone] = useState(false);
  const flowNodes = [
    { id: "request", label: "Auftrag erfasst", status: "done" as const },
    { id: "review", label: "Prüfung", status: flowDone ? "done" as const : "active" as const, items: [{ label: "Vollständigkeit", status: flowDone ? "done" as const : "active" as const }] },
    { id: "result", label: "Ergebnis", detail: flowDone ? "Bereit" : "Offen", status: flowDone ? "done" as const : "pending" as const },
  ];
  const flowEdges = [{ source: "request", target: "review" }, { source: "review", target: "result" }];
  const [starPushed, setStarPushed] = useState<string[]>([]);
  const starBranch = (id: string, project: string, toMain: "done" | "active" | "pending") => ({
    id, label: project, status: toMain === "active" ? "active" as const : toMain === "done" ? "done" as const : "pending" as const, running: toMain === "active",
    items: [{ label: `Nach main: ${toMain === "done" ? "fertig" : toMain === "active" ? "läuft" : "offen"}`, status: toMain }, { label: "Von main: offen", status: "pending" as const }],
    actions: [{ id: "push", label: starPushed.includes(id) ? "Gepusht" : "Pushen", primary: !starPushed.includes(id), disabled: starPushed.includes(id) }],
  });
  const starNodes = [
    { id: "main", label: "main", status: "active" as const, items: [{ label: "Nach main: 1/3", status: "pending" as const }] },
    starBranch("alpha", "alpha", "done"), starBranch("beta", "beta", "active"), starBranch("gamma", "gamma", "pending"),
  ];
  const starEdges = ["alpha", "beta", "gamma"].flatMap((id, index) => [
    { id: `${id} nach main`, source: id, target: "main", status: (["done", "active", "pending"] as const)[index] },
    { id: `main nach ${id}`, source: "main", target: id, status: "pending" as const },
  ]);
  const rows = [{ id: "one", name: "Analyse", count: 12 }, { id: "two", name: "Review", count: 4 }, { id: "three", name: "Dokumentation", count: 8 }];
  return <>
    <section data-component="Button Badge Toggle ToggleGroup Tooltip" className="reference-ui-example">
      <h3>Schaltflächen, Badges und Umschalter</h3>
      <p>Die Bausteine sind shadcn/ui-Komponenten auf Base UI mit Tailwind. Varianten und Größen heißen wie in shadcn: <code>default</code> ist die Hauptaktion, <code>outline</code> die gerahmte Nebenaktion, <code>ghost</code> die stille, <code>destructive</code> das Löschende; Größen <code>sm</code>, <code>lg</code> und <code>icon</code>.</p>
      <div className="reference-ui-controls">
        <Button>Hauptaktion</Button>
        <Button variant="outline">Standard</Button>
        <Button variant="secondary">Sekundär</Button>
        <Button variant="ghost">Nebenaktion</Button>
        <Button variant="destructive">Löschen</Button>
        <Button disabled>Inaktiv</Button>
        <Button size="sm" variant="outline">Klein</Button>
        <Button size="lg" variant="outline">Groß</Button>
        <TooltipProvider>
          <Tooltip><TooltipTrigger render={<Button aria-label="Schließen" className="rounded-full" size="icon" variant="outline" />}><XIcon /></TooltipTrigger><TooltipContent>Schließen</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger render={<Button aria-label="Zurück" size="icon" variant="ghost" />}><ArrowLeftIcon /></TooltipTrigger><TooltipContent>Zurück</TooltipContent></Tooltip>
        </TooltipProvider>
        <Button size="sm" variant="ghost"><Trash2Icon />Mit Icon</Button>
      </div>
      <div className="reference-ui-controls">
        <Badge>Neu</Badge>
        <Badge variant="secondary">3 offen</Badge>
        <Badge variant="destructive">2 Befunde</Badge>
        <Badge variant="outline">Entwurf</Badge>
        <Toggle aria-label="Anheften" onPressedChange={setPinned} pressed={pinned} size="sm" variant="outline">{pinned ? "Angeheftet" : "Anheften"}</Toggle>
      </div>
      <div className="reference-ui-controls">
        <ToggleGroup aria-label="Filter" size="sm" value={[filter]} variant="outline" onValueChange={([next]) => { if (next) setFilter(next); }}>
          {["Alle", "Offen", "Erledigt"].map((label) => <ToggleGroupItem key={label} value={label}>{label}</ToggleGroupItem>)}
        </ToggleGroup>
        <ToggleGroup aria-label="Ansicht" size="sm" spacing={0} value={[view]} variant="outline" onValueChange={([next]) => { if (next) setView(next); }}>
          <ToggleGroupItem value="list">Liste</ToggleGroupItem>
          <ToggleGroupItem value="board">Board</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <p aria-live="polite">Filter: {filter}, Ansicht: {view}</p>
    </section>
    <section data-component="Tabs" className="reference-ui-example">
      <h3>Reiter</h3>
      <p>Reiter wechseln zwischen den Ansichten einer Fläche, mit Pfeiltasten. Eine Anzahl je Reiter ist ein Badge: <code>destructive</code> zählt, was den Benutzer braucht; <code>secondary</code> ist nur eine Menge.</p>
      <Tabs onValueChange={(value) => setTab(String(value))} value={tab}>
        <TabsList aria-label="Bereiche" variant="line">
          <TabsTrigger value="status">Stand</TabsTrigger>
          <TabsTrigger value="findings">Befunde<Badge variant="destructive">2</Badge></TabsTrigger>
          <TabsTrigger value="evidence">Nachweise<Badge variant="secondary">3</Badge></TabsTrigger>
        </TabsList>
        <TabsContent value="status">Der aktuelle Stand der lokalen Demo.</TabsContent>
        <TabsContent value="findings">Zwei Befunde, die den Benutzer brauchen.</TabsContent>
        <TabsContent value="evidence">Drei Nachweise ohne Handlungsbedarf.</TabsContent>
      </Tabs>
      <p aria-live="polite">Reiter: {tab}</p>
    </section>
    <section data-component="Dialog" className="reference-ui-example">
      <h3>Dialog</h3>
      <p>Der Dialog liegt über dem Inhalt, fängt den Fokus und schließt mit Escape oder Hintergrundklick. Mini-Apps verwenden ihn innerhalb ihres Frames.</p>
      <Button onClick={() => setDialogOpen(true)} variant="outline">Dialog öffnen</Button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Beispiel bestätigen</DialogTitle>
            <DialogDescription>Ein lokaler Dialog ohne Wirkung außerhalb dieser Seite.</DialogDescription>
          </DialogHeader>
          <p>Der Rumpf nimmt beliebigen Inhalt auf, etwa ein Formular oder eine Vorschau.</p>
          <DialogFooter>
            <Button onClick={() => setDialogOpen(false)} variant="outline">Abbrechen</Button>
            <Button onClick={() => setDialogOpen(false)}>Bestätigen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
    <section data-component="Form" className="reference-ui-example">
      <h3>Formular</h3>
      <p>Die Felder, Regeln und Sendeaktion kommen aus der Mini-App. Kurze Eingabehilfen erscheinen im leeren Feld, dauerhafte Hinweise darunter. Absenden zeigt hier nur die lokalen Werte.</p>
      <Form fields={[
        { id: "title", label: "Auftrag", type: "text", placeholder: "Was soll bearbeitet werden?", required: true },
        { id: "notes", label: "Hinweise", type: "textarea", rows: 3, placeholder: "Was soll bei der Bearbeitung berücksichtigt werden?", hint: "Mehrzeiliger Text bleibt im Formular ausgerichtet." },
        { id: "count", label: "Anzahl", type: "number", placeholder: "Anzahl der Ergebnisse", hint: "1 bis 10 Ergebnisse.", min: 1, max: 10, required: true },
        { id: "mode", label: "Modus", type: "select", options: [{ value: "review", label: "Prüfen" }, { value: "draft", label: "Entwerfen" }] },
        { id: "approved", label: "Auswahl bestätigt", type: "checkbox", required: true },
      ]} values={values} onChange={setValues} onSubmit={async (next) => { setResult(JSON.stringify(next)); }} submitLabel="Werte anzeigen" />
      <p aria-live="polite">{result}</p>
    </section>
    <section data-component="DataTable" className="reference-ui-example">
      <h3>Datentabelle</h3>
      <p>Spalten lassen sich sortieren, die Suche filtert Zeilen. Die Auswahl gehört der Mini-App.</p>
      <DataTable rows={rows} rowKey={(row) => row.id} filterable selectedKeys={selected} onSelectionChange={setSelected}
        columns={[{ id: "name", label: "Arbeit", value: (row) => row.name, sortable: true }, { id: "count", label: "Ergebnisse", value: (row) => row.count, sortable: true }]}
        actions={[{ id: "open", label: "Auswählen", onClick: (row) => { setSelected([row.id]); } }]} />
      <p aria-live="polite">{selected.length} Zeilen ausgewählt</p>
    </section>
    <section data-component="FilePicker" className="reference-ui-example">
      <h3>Dateiauswahl</h3>
      <p>Auswahl, Drag-and-drop und Einfügen aus der Zwischenablage mit lokalen Vorschauen. Es werden keine Dateien übertragen.</p>
      <FilePicker label="Dateien für die Vorschau" files={files} onChange={setFiles} maxFiles={5} maxBytes={10 * 1024 * 1024} />
    </section>
    <section data-component="TaskProgress" className="reference-ui-example">
      <h3>Aufgabenfortschritt</h3>
      <TaskProgress tasks={[{ id: "read", label: "Unterlagen lesen", status: "done" }, { id: "check", label: "Ergebnisse prüfen", status: "running", description: "Beispielstatus aus der Mini-App." }, { id: "write", label: "Bericht erstellen", status: "pending" }]} />
    </section>
    <section data-component="FlowDiagram" className="reference-ui-example">
      <h3>Diagramme mit Auto-Layout</h3>
      <p>Die Mini-App übergibt Knoten, einzelne Prüfpunkte und Verbindungen. React Flow und ELK ordnen sie automatisch an. Die Übersicht zeigt umbrechende Punkte mit eindeutigen Statussymbolen. Aktive Arbeit ist dezent animiert; ausführliche Beschreibungen erscheinen beim Darüberfahren. Die Grafik passt sich an die Breite an, höchstens bis zu 80 Prozent der Entwurfsgröße, ohne eigenen Hintergrund; der Inhalt scrollt ohne eigene Zoomsteuerung. Der Status ist lokal umschaltbar, ohne Modell oder Run.</p>
      <FlowDiagram nodes={flowNodes} edges={flowEdges} viewport="fit-width" label={flowDone ? "Auftrag erfasst, Prüfung abgeschlossen, Ergebnis bereit" : "Auftrag erfasst, Prüfung läuft, Ergebnis offen"} />
      <Button onClick={() => setFlowDone((done) => !done)} variant="outline">Prüfstatus im Diagramm umschalten</Button>
      <details><summary>Diagrammdaten</summary><pre><code>{JSON.stringify({ nodes: flowNodes, edges: flowEdges }, null, 2)}</code></pre></details>
      <h3>Sternförmig und eingepasst</h3>
      <p>Mit <code>layout="star"</code> steht der erste Knoten in der Mitte, die übrigen verteilen sich links und rechts. Kanten tragen einen Status, Gegenrichtungen liegen nebeneinander. <code>viewport="fit"</code> passt Breite und Höhe in den Container ein. Karten können <code>actions</code> tragen; der Klick kommt über <code>onAction</code> zurück.</p>
      <div style={{ height: 360 }}>
        <FlowDiagram layout="star" viewport="fit" nodes={starNodes} edges={starEdges} label="main in der Mitte, drei Branches darum, jede Karte mit Push-Aktion" onAction={(node) => setStarPushed((pushed) => [...pushed, node])} />
      </div>
    </section>
    <section data-component="WorkflowDiagram" className="reference-ui-example">
      <h3>Ablauf aus einer gemeinsamen Definition</h3>
      <p>Dieselbe Definition beschreibt die Aufgaben der LLM-Helfer und das Diagramm des Lernnachmittags. Die längeren Anweisungen liegen in referenzierten Promptdateien. Hier wird nur der lokale Beispielstatus umgeschaltet; es starten keine Modelle.</p>
      <WorkflowDiagram definition={learningWorkflow} label="Zwei Ideen parallel erarbeiten und gemeinsam sammeln" state={{ steps: {
        experiment: { status: "done" },
        quiz: { status: flowDone ? "done" : "active" },
        collect: { status: flowDone ? "done" : "pending" },
      } }} />
      <Button onClick={() => setFlowDone((done) => !done)} variant="outline">Zweiten Beitrag umschalten</Button>
    </section>
    <section data-component="SvgEdge" className="reference-ui-example">
      <h3>SVG-Verbindungen</h3>
      <p>Gemeinsame Kanten mit Pfeilen, Zustandsfarben und optionaler Bewegung. Knoten, Beschriftungen und Positionen sind normales SVG aus der Mini-App; SvgEdge berechnet kein Layout.</p>
      <svg viewBox="0 0 360 160" role="img" aria-label={diagramDone ? "Eingang fertig, Prüfung abgeschlossen, Ergebnis bereit" : "Eingang fertig, Prüfung läuft, Ergebnis offen"}
        style={{ display: "block", width: "100%", maxWidth: 540, height: "auto", fontFamily: "var(--font-sans)", fontSize: 13 }}>
        <SvgEdge d="M112 42 L144 42" tone={diagramDone ? "success" : "warning"} active={!diagramDone} />
        <SvgEdge d="M252 42 C320 42 320 118 252 118" arrow={diagramDone ? "end" : "none"} tone={diagramDone ? "success" : "neutral"} lineStyle={diagramDone ? "solid" : "dashed"} />
        <SvgEdge d="M144 118 C64 118 64 96 64 72" arrow="both" tone="accent" />
        {[{ x: 8, y: 12, label: "Eingang", status: "Fertig" },
          { x: 148, y: 12, label: "Prüfung", status: diagramDone ? "Fertig" : "Läuft" },
          { x: 148, y: 88, label: "Ergebnis", status: diagramDone ? "Bereit" : "Offen" }].map((node) => <g key={node.label}>
            <rect x={node.x} y={node.y} width="104" height="56" rx="8" fill="var(--background)" stroke="var(--border-strong)" />
            <text x={node.x + 52} y={node.y + 23} textAnchor="middle" fill="var(--foreground)" fontWeight="600">{node.label}</text>
            <text x={node.x + 52} y={node.y + 42} textAnchor="middle" fill="var(--muted-foreground)" fontSize="11">{node.status}</text>
          </g>)}
      </svg>
      <Button onClick={() => setDiagramDone((done) => !done)} variant="outline">Beispielstatus umschalten</Button>
    </section>
    <section data-component="DocumentViewer DiffViewer" className="reference-ui-example">
      <h3>Dokumente und Änderungen</h3>
      <DocumentViewer title="Ergebnis" format="markdown" content="## Prüfung\n\nZwei Einträge sind vollständig. **Ein Eintrag** ist noch offen." />
      <DiffViewer patch={"--- a/result.txt\n+++ b/result.txt\n@@ -1 +1 @@\n-Status: offen\n+Status: geprüft"} />
    </section>
  </>;
}

function Showcase() {
  const [messages, setMessages] = useState(initialMessages);
  const [feed, setFeed] = useState<Parameters<typeof MessageList>[0]["messages"]>([
    { key: "editorial", sender: "Redaktion", text: "Der Hinweis soll **kurz und verständlich** bleiben." },
    { key: "review", sender: "Textprüfung", text: "Öffnungszeiten und Reparaturhinweis bleiben erhalten." },
  ]);
  const [feedOwner, setFeedOwner] = useState("");
  const [drafts, setDrafts] = useState<Message[]>([]);
  const [selection, setSelection] = useState("overview");
  const [markdown, setMarkdown] = useState("**Markdown** wird direkt mit dem vorhandenen Baustein gerendert.\n\n- Text bearbeiten\n- Darstellung ansehen\n\n`Code` bleibt lesbar.");
  const ownerOptions = [{ value: "", label: "Alle mit Sprechblase" }, { value: "Redaktion", label: "Redaktion" }, { value: "Textprüfung", label: "Textprüfung" }];
  const viewOptions = [{ value: "overview", label: "Überblick" }, { value: "details", label: "Details" }, { value: "result", label: "Ergebnis" }];
  const append = (text: string, attachments?: ChatAttachmentInput[]) => setMessages((current) => [
    ...current,
    localMessage(`message-${current.length}`, text, attachments),
  ]);

  return (
    <div className="reference-ui-showcase">
      <p className="reference-ui-notice">Lokale Demo, kein Modell und kein Run. Eingaben werden nur im Browser angezeigt und beim Neuladen verworfen.</p>
      <LayoutShowcase />
      <section data-component="Chat" className="reference-ui-example">
        <h3>Chat</h3>
        <p>Kontrollierter Verlauf mit eigener Eingabe. Eine abgeschickte Nachricht erscheint im Verlauf.</p>
        <div className="reference-ui-chat"><Chat messages={messages} onSend={append} attachmentCapabilities={attachmentCapabilities} placeholder="Nachricht lokal anzeigen ..." rows={2} /></div>
        <Button className="reference-ui-reset" onClick={() => setMessages(initialMessages)} variant="outline">Verlauf zurücksetzen</Button>
      </section>
      <section data-component="ChatMessages ChatInput" className="reference-ui-example">
        <h3>ChatMessages und ChatInput</h3>
        <p>Dieselben Teile lassen sich getrennt platzieren. Die Eingabe ergänzt den Verlauf darunter.</p>
        <ChatInput onSend={(text, attachments) => setDrafts((current) => [...current, localMessage(`draft-${current.length}`, text, attachments)])} attachmentCapabilities={attachmentCapabilities} placeholder="Getrennte Eingabe ausprobieren ..." rows={2} />
        <div className="reference-ui-messages"><ChatMessages messages={drafts} emptyState={<p>Noch keine lokale Eingabe.</p>} /></div>
      </section>
      <section data-component="MessageList" className="reference-ui-example">
        <h3>Nachrichtenliste mit mehreren Absendern</h3>
        <p>Die Auswahl bestimmt, welcher Absender ohne Sprechblase erscheint. Die Schaltfläche ergänzt den lokalen Verlauf.</p>
        <Select items={ownerOptions} value={feedOwner} onValueChange={(value) => setFeedOwner(value ?? "")}>
          <SelectTrigger aria-label="Absender ohne Sprechblase"><SelectValue /></SelectTrigger>
          <SelectContent>{ownerOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
        <div className="reference-ui-messages"><MessageList messages={feed} owner={feedOwner || null} label="Lokale Redaktionsnotizen" /></div>
        <Button onClick={() => setFeed((current) => [...current, {
          key: `note-${current.length}`, sender: current.length % 2 ? "Textprüfung" : "Redaktion",
          text: `Lokale Beispielnotiz ${current.length - 1}: Diese Nachricht wurde gerade ergänzt.`,
        }]) } variant="outline">Lokale Nachricht ergänzen</Button>
      </section>
      <section data-component="Select" className="reference-ui-example">
        <h3>Select</h3>
        <p>Eine Auswahl aus mehreren Werten, zusammengesetzt aus <code>Select</code>, <code>SelectTrigger</code>, <code>SelectValue</code>, <code>SelectContent</code> und <code>SelectItem</code>; <code>items</code> liefert die Beschriftungen, <code>multiple</code> erlaubt Mehrfachauswahl.</p>
        <Select items={viewOptions} value={selection} onValueChange={(value) => { if (value !== null) setSelection(value); }}>
          <SelectTrigger aria-label="Ansicht der lokalen Demo"><SelectValue /></SelectTrigger>
          <SelectContent>{viewOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
        <p className="reference-ui-selection" aria-live="polite">Ausgewählter Wert: <code>{selection}</code></p>
      </section>
      <section data-component="Markdown" className="reference-ui-example">
        <h3>Markdown</h3>
        <label className="reference-ui-label" htmlFor="reference-markdown">Text zum Bearbeiten</label>
        <textarea id="reference-markdown" rows={6} value={markdown} onChange={(event) => setMarkdown(event.target.value)} />
        <div className="reference-ui-markdown"><Markdown text={markdown} /></div>
      </section>
      <ControlsShowcase />
      <ListDetailShowcase />
    </div>
  );
}

const root = document.getElementById("ui-showcase");
if (!root) throw new Error("Der UI-Showcase benötigt das Element ui-showcase.");
root.dataset.uiSurface = "mini-app";
createRoot(root).render(<Showcase />);
