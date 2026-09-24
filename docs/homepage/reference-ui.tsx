import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppLayout, Stack, Grid, Chat, ChatInput, ChatMessages, MessageList, Markdown, Form, DataTable, FilePicker, TaskProgress, DocumentViewer, DiffViewer, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger, Toggle, ToggleGroup, ToggleGroupItem, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, ListDetail, SvgEdge, FlowDiagram, WorkflowDiagram } from "../../apps/web/src/actor-programs/client-ui/index";
import { learningWorkflow } from "../../plugins/ragents.reference/run-scripts/learning-afternoon/src/workflow";
import { ArrowLeftIcon, CheckIcon, SparklesIcon, Trash2Icon, WrenchIcon, XIcon } from "lucide-react";
import type { ChatAttachmentInput, Message, FormValues, ListDetailItem } from "../../apps/web/src/actor-programs/client-ui/contracts";
import "../../apps/web/src/actor-programs/client-ui/flow-diagram.css";

const initialMessages: Message[] = [
  { key: "intro", role: "assistant", text: "This is the existing chat component. Your input stays inside this local demo.", closed: true },
];

const attachmentCapabilities = { input: ["text", "image", "video", "file"], model: "Local demo" };

const localMessage = (key: string, text: string, attachments: ChatAttachmentInput[] = []): Message => ({
  key, role: "user", text, closed: true,
  attachments: attachments.map(({ name, mediaType, data }) => ({
    name, mediaType, size: atob(data).length, url: `data:${mediaType};base64,${data}`,
  })),
});

function ListDetailShowcase() {
  const [selectedId, setSelectedId] = useState("draft");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState("No selection applied yet.");
  const items: ListDetailItem[] = [
    { id: "draft", title: "Text draft", description: "Work together on a short message.", group: "In progress", icon: <SparklesIcon size={14} />, meta: "Draft", tone: "accent" },
    { id: "review", title: "Review content", description: "Capture open questions and next steps.", group: "In progress", icon: <WrenchIcon size={14} />, meta: "Review", tone: "purple" },
    { id: "result", title: "Read result", description: "View the completed sample text.", group: "Completed", icon: <CheckIcon size={14} />, meta: "Result", tone: "success" },
  ];
  const visible = items.filter((item) => `${item.title} ${item.description}`.toLocaleLowerCase("en").includes(query.toLocaleLowerCase("en")));
  const selected = visible.find((item) => item.id === selectedId);
  return <section className="reference-ui-example" data-component="ListDetail">
    <h3>List with detail view</h3>
    <p>The list selects an item. Only the action in the detail view applies it. On narrow screens, "Back to selection" returns to the list.</p>
    <div style={{ display: "flex", height: 380, marginTop: 16 }}>
      <ListDetail label="Local examples" items={visible} selectedId={selectedId} onSelect={setSelectedId}
        toolbar={<Input aria-label="Search examples" onChange={(event) => setQuery(event.target.value)} placeholder="Search examples" type="search" value={query} />}
        detailLabel="View example" detailHeader={selected && <><h3>{selected.title}</h3><p>{selected.description}</p></>}
        detailFooter={selected && <Button onClick={() => setResult(`Applied: ${selected.title}`)}>Apply selection</Button>}
        emptyState={<p>No examples match this search.</p>}>
        <p>This is a local detail view. The selection changes only this demo; it does not start agents or workflows.</p>
      </ListDetail>
    </div>
    <p aria-live="polite">{result}</p>
  </section>;
}

function LayoutShowcase() {
  const [values, setValues] = useState<FormValues>({ answer: "" });
  const [answer, setAnswer] = useState("");
  return <section data-component="AppLayout Stack Grid" className="reference-ui-example">
    <h3>App frame, spacing, and responsive columns</h3>
    <p>AppLayout provides the title and content frame, while Stack arranges content at consistent intervals. Grid shows two columns here and switches to one when space is tight. This form demo needs no custom app CSS.</p>
    <AppLayout title="Balcony design" description="Local demo: Your answer appears unchanged beside the form. No model, no run, and no storage after reloading."
      actions={<Button onClick={() => { setValues({ answer: "" }); setAnswer(""); }} variant="outline">Reset</Button>}>
      <Grid>
        <Stack>
          <Stack direction="row" gap="small">
            <span>A sample question</span>
            <span aria-live="polite">{answer ? "Answer applied" : "Answer pending"}</span>
          </Stack>
          <p>How large is your balcony, and which direction does it face?</p>
          <Form title="Your details" fields={[
            { id: "answer", label: "Your answer", type: "textarea", rows: 4, required: true, placeholder: "For example: 4 square meters, south-facing", hint: "Submitting only displays the text you entered." },
          ]} values={values} onChange={setValues} onSubmit={async (next) => { setAnswer(String(next.answer)); }} submitLabel="Show answer locally" />
        </Stack>
        <Stack gap="small">
          <h3>Applied answer</h3>
          <div aria-live="polite"><DocumentViewer format="text" content={answer || "No answer applied yet."} /></div>
        </Stack>
      </Grid>
    </AppLayout>
  </section>;
}

function ControlsShowcase() {
  const [values, setValues] = useState<FormValues>({ title: "Review results", notes: "", count: 3, mode: "review", approved: false });
  const [result, setResult] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [filter, setFilter] = useState("All");
  const [view, setView] = useState("list");
  const [tab, setTab] = useState("status");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [diagramDone, setDiagramDone] = useState(false);
  const [flowDone, setFlowDone] = useState(false);
  const flowNodes = [
    { id: "request", label: "Request received", status: "done" as const },
    { id: "review", label: "Review", status: flowDone ? "done" as const : "active" as const, items: [{ label: "Completeness", status: flowDone ? "done" as const : "active" as const }] },
    { id: "result", label: "Result", detail: flowDone ? "Ready" : "Open", status: flowDone ? "done" as const : "pending" as const },
  ];
  const flowEdges = [{ source: "request", target: "review" }, { source: "review", target: "result" }];
  const [starPushed, setStarPushed] = useState<string[]>([]);
  const starBranch = (id: string, project: string, toMain: "done" | "active" | "pending") => ({
    id, label: project, status: toMain === "active" ? "active" as const : toMain === "done" ? "done" as const : "pending" as const, running: toMain === "active",
    items: [{ label: `To main: ${toMain === "done" ? "done" : toMain === "active" ? "running" : "open"}`, status: toMain }, { label: "From main: open", status: "pending" as const }],
    actions: [{ id: "push", label: starPushed.includes(id) ? "Pushed" : "Push", primary: !starPushed.includes(id), disabled: starPushed.includes(id) }],
  });
  const starNodes = [
    { id: "main", label: "main", status: "active" as const, items: [{ label: "To main: 1/3", status: "pending" as const }] },
    starBranch("alpha", "alpha", "done"), starBranch("beta", "beta", "active"), starBranch("gamma", "gamma", "pending"),
  ];
  const starEdges = ["alpha", "beta", "gamma"].flatMap((id, index) => [
    { id: `${id} to main`, source: id, target: "main", status: (["done", "active", "pending"] as const)[index] },
    { id: `main to ${id}`, source: "main", target: id, status: "pending" as const },
  ]);
  const rows = [{ id: "one", name: "Analysis", count: 12 }, { id: "two", name: "Review", count: 4 }, { id: "three", name: "Documentation", count: 8 }];
  return <>
    <section data-component="Button Badge Toggle ToggleGroup Tooltip" className="reference-ui-example">
      <h3>Buttons, badges, and toggles</h3>
      <p>These building blocks are shadcn/ui components built on Base UI with Tailwind. Variant and size names follow shadcn: <code>default</code> is the primary action, <code>outline</code> is the framed secondary action, <code>ghost</code> is unobtrusive, and <code>destructive</code> indicates deletion; sizes are <code>sm</code>, <code>lg</code>, and <code>icon</code>.</p>
      <div className="reference-ui-controls">
        <Button>Primary action</Button>
        <Button variant="outline">Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Minor action</Button>
        <Button variant="destructive">Delete</Button>
        <Button disabled>Disabled</Button>
        <Button size="sm" variant="outline">Small</Button>
        <Button size="lg" variant="outline">Large</Button>
        <TooltipProvider>
          <Tooltip><TooltipTrigger render={<Button aria-label="Close" className="rounded-full" size="icon" variant="outline" />}><XIcon /></TooltipTrigger><TooltipContent>Close</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger render={<Button aria-label="Back" size="icon" variant="ghost" />}><ArrowLeftIcon /></TooltipTrigger><TooltipContent>Back</TooltipContent></Tooltip>
        </TooltipProvider>
        <Button size="sm" variant="ghost"><Trash2Icon />With icon</Button>
      </div>
      <div className="reference-ui-controls">
        <Badge>New</Badge>
        <Badge variant="secondary">3 open</Badge>
        <Badge variant="destructive">2 findings</Badge>
        <Badge variant="outline">Draft</Badge>
        <Toggle aria-label="Pin" onPressedChange={setPinned} pressed={pinned} size="sm" variant="outline">{pinned ? "Pinned" : "Pin"}</Toggle>
      </div>
      <div className="reference-ui-controls">
        <ToggleGroup aria-label="Filter" size="sm" value={[filter]} variant="outline" onValueChange={([next]) => { if (next) setFilter(next); }}>
          {["All", "Open", "Completed"].map((label) => <ToggleGroupItem key={label} value={label}>{label}</ToggleGroupItem>)}
        </ToggleGroup>
        <ToggleGroup aria-label="View" size="sm" spacing={0} value={[view]} variant="outline" onValueChange={([next]) => { if (next) setView(next); }}>
          <ToggleGroupItem value="list">List</ToggleGroupItem>
          <ToggleGroupItem value="board">Board</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <p aria-live="polite">Filter: {filter}, view: {view}</p>
    </section>
    <section data-component="Tabs" className="reference-ui-example">
      <h3>Tabs</h3>
      <p>Tabs switch between views of the same surface and support arrow-key navigation. A count on a tab is a badge: <code>destructive</code> counts items that need the user, while <code>secondary</code> is only a quantity.</p>
      <Tabs onValueChange={(value) => setTab(String(value))} value={tab}>
        <TabsList aria-label="Sections" variant="line">
          <TabsTrigger value="status">Status</TabsTrigger>
          <TabsTrigger value="findings">Findings<Badge variant="destructive">2</Badge></TabsTrigger>
          <TabsTrigger value="evidence">Evidence<Badge variant="secondary">3</Badge></TabsTrigger>
        </TabsList>
        <TabsContent value="status">The current state of the local demo.</TabsContent>
        <TabsContent value="findings">Two findings that need the user.</TabsContent>
        <TabsContent value="evidence">Three pieces of evidence that need no action.</TabsContent>
      </Tabs>
      <p aria-live="polite">Tab: {tab}</p>
    </section>
    <section data-component="Dialog" className="reference-ui-example">
      <h3>Dialog</h3>
      <p>The dialog appears above the content, traps focus, and closes with Escape or a backdrop click. Mini-apps use it inside their frame.</p>
      <Button onClick={() => setDialogOpen(true)} variant="outline">Open dialog</Button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm example</DialogTitle>
            <DialogDescription>A local dialog with no effect outside this page.</DialogDescription>
          </DialogHeader>
          <p>The body accepts arbitrary content, such as a form or preview.</p>
          <DialogFooter>
            <Button onClick={() => setDialogOpen(false)} variant="outline">Cancel</Button>
            <Button onClick={() => setDialogOpen(false)}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
    <section data-component="Form" className="reference-ui-example">
      <h3>Form</h3>
      <p>The fields, rules, and submit action come from the mini-app. Short input hints appear in the empty field, with persistent guidance below it. Submitting only displays the local values here.</p>
      <Form fields={[
        { id: "title", label: "Task", type: "text", placeholder: "What should be worked on?", required: true },
        { id: "notes", label: "Notes", type: "textarea", rows: 3, placeholder: "What should be considered?", hint: "Multiline text stays aligned within the form." },
        { id: "count", label: "Count", type: "number", placeholder: "Number of results", hint: "1 to 10 results.", min: 1, max: 10, required: true },
        { id: "mode", label: "Mode", type: "select", options: [{ value: "review", label: "Review" }, { value: "draft", label: "Draft" }] },
        { id: "approved", label: "Selection confirmed", type: "checkbox", required: true },
      ]} values={values} onChange={setValues} onSubmit={async (next) => { setResult(JSON.stringify(next)); }} submitLabel="Show values" />
      <p aria-live="polite">{result}</p>
    </section>
    <section data-component="DataTable" className="reference-ui-example">
      <h3>Data table</h3>
      <p>Columns can be sorted, and search filters the rows. The mini-app owns the selection.</p>
      <DataTable rows={rows} rowKey={(row) => row.id} filterable selectedKeys={selected} onSelectionChange={setSelected}
        columns={[{ id: "name", label: "Work", value: (row) => row.name, sortable: true }, { id: "count", label: "Results", value: (row) => row.count, sortable: true }]}
        actions={[{ id: "open", label: "Select", onClick: (row) => { setSelected([row.id]); } }]} />
      <p aria-live="polite">{selected.length} rows selected</p>
    </section>
    <section data-component="FilePicker" className="reference-ui-example">
      <h3>File picker</h3>
      <p>Select, drag and drop, or paste from the clipboard with local previews. No files are uploaded.</p>
      <FilePicker label="Files for preview" files={files} onChange={setFiles} maxFiles={5} maxBytes={10 * 1024 * 1024} />
    </section>
    <section data-component="TaskProgress" className="reference-ui-example">
      <h3>Task progress</h3>
      <TaskProgress tasks={[{ id: "read", label: "Read materials", status: "done" }, { id: "check", label: "Review results", status: "running", description: "Sample status from the mini-app." }, { id: "write", label: "Write report", status: "pending" }]} />
    </section>
    <section data-component="FlowDiagram" className="reference-ui-example">
      <h3>Diagrams with automatic layout</h3>
      <p>The mini-app provides nodes, individual checkpoints, and connections. React Flow and ELK arrange them automatically. The overview shows wrapping items with unambiguous status symbols. Active work is subtly animated, and detailed descriptions appear on hover. The graphic adapts to the available width, up to 80 percent of its designed size, without a separate background; its content scrolls without dedicated zoom controls. You can change the status locally without a model or run.</p>
      <FlowDiagram nodes={flowNodes} edges={flowEdges} viewport="fit-width" label={flowDone ? "Request received, review completed, result ready" : "Request received, review running, result open"} />
      <Button onClick={() => setFlowDone((done) => !done)} variant="outline">Toggle review status in diagram</Button>
      <details><summary>Diagram data</summary><pre><code>{JSON.stringify({ nodes: flowNodes, edges: flowEdges }, null, 2)}</code></pre></details>
      <h3>Star layout fitted to its container</h3>
      <p>With <code>layout="star"</code>, the first node is centered and the remaining nodes are distributed to its left and right. Edges carry a status, and opposite directions run beside one another. <code>viewport="fit"</code> fits both width and height into the container. Cards can provide <code>actions</code>; clicks return through <code>onAction</code>.</p>
      <div style={{ height: 360 }}>
        <FlowDiagram layout="star" viewport="fit" nodes={starNodes} edges={starEdges} label="main in the center with three branches, each card with a push action" onAction={(node) => setStarPushed((pushed) => [...pushed, node])} />
      </div>
    </section>
    <section data-component="WorkflowDiagram" className="reference-ui-example">
      <h3>Workflow from a shared definition</h3>
      <p>The same definition describes the tasks for the LLM helpers and the learning-session diagram. Longer instructions live in referenced prompt files. This control only changes the local sample status; it starts no models.</p>
      <WorkflowDiagram definition={learningWorkflow} label="Develop two ideas in parallel and collect them together" state={{ steps: {
        experiment: { status: "done" },
        quiz: { status: flowDone ? "done" : "active" },
        collect: { status: flowDone ? "done" : "pending" },
      } }} />
      <Button onClick={() => setFlowDone((done) => !done)} variant="outline">Toggle second contribution</Button>
    </section>
    <section data-component="SvgEdge" className="reference-ui-example">
      <h3>SVG connections</h3>
      <p>Shared edges with arrows, status colors, and optional motion. Nodes, labels, and positions are ordinary SVG supplied by the mini-app; SvgEdge does not calculate a layout.</p>
      <svg viewBox="0 0 360 160" role="img" aria-label={diagramDone ? "Input complete, review completed, result ready" : "Input complete, review running, result open"}
        style={{ display: "block", width: "100%", maxWidth: 540, height: "auto", fontFamily: "var(--font-sans)", fontSize: 13 }}>
        <SvgEdge d="M112 42 L144 42" tone={diagramDone ? "success" : "warning"} active={!diagramDone} />
        <SvgEdge d="M252 42 C320 42 320 118 252 118" arrow={diagramDone ? "end" : "none"} tone={diagramDone ? "success" : "neutral"} lineStyle={diagramDone ? "solid" : "dashed"} />
        <SvgEdge d="M144 118 C64 118 64 96 64 72" arrow="both" tone="accent" />
        {[{ x: 8, y: 12, label: "Input", status: "Done" },
          { x: 148, y: 12, label: "Review", status: diagramDone ? "Done" : "Running" },
          { x: 148, y: 88, label: "Result", status: diagramDone ? "Ready" : "Open" }].map((node) => <g key={node.label}>
            <rect x={node.x} y={node.y} width="104" height="56" rx="8" fill="var(--background)" stroke="var(--border-strong)" />
            <text x={node.x + 52} y={node.y + 23} textAnchor="middle" fill="var(--foreground)" fontWeight="600">{node.label}</text>
            <text x={node.x + 52} y={node.y + 42} textAnchor="middle" fill="var(--muted-foreground)" fontSize="11">{node.status}</text>
          </g>)}
      </svg>
      <Button onClick={() => setDiagramDone((done) => !done)} variant="outline">Toggle sample status</Button>
    </section>
    <section data-component="DocumentViewer DiffViewer" className="reference-ui-example">
      <h3>Documents and changes</h3>
      <DocumentViewer title="Result" format="markdown" content="## Review\n\nTwo items are complete. **One item** is still open." />
      <DiffViewer patch={"--- a/result.txt\n+++ b/result.txt\n@@ -1 +1 @@\n-Status: open\n+Status: reviewed"} />
    </section>
  </>;
}

function Showcase() {
  const [messages, setMessages] = useState(initialMessages);
  const [feed, setFeed] = useState<Parameters<typeof MessageList>[0]["messages"]>([
    { key: "editorial", sender: "Editorial", text: "The notice should remain **short and easy to understand**." },
    { key: "review", sender: "Copy review", text: "Opening hours and the repair notice remain unchanged." },
  ]);
  const [feedOwner, setFeedOwner] = useState("");
  const [drafts, setDrafts] = useState<Message[]>([]);
  const [selection, setSelection] = useState("overview");
  const [markdown, setMarkdown] = useState("**Markdown** is rendered directly with the existing component.\n\n- Edit text\n- View rendering\n\n`Code` remains readable.");
  const ownerOptions = [{ value: "", label: "Speech bubbles for everyone" }, { value: "Editorial", label: "Editorial" }, { value: "Copy review", label: "Copy review" }];
  const viewOptions = [{ value: "overview", label: "Overview" }, { value: "details", label: "Details" }, { value: "result", label: "Result" }];
  const append = (text: string, attachments?: ChatAttachmentInput[]) => setMessages((current) => [
    ...current,
    localMessage(`message-${current.length}`, text, attachments),
  ]);

  return (
    <div className="reference-ui-showcase">
      <p className="reference-ui-notice">Local demo, no model and no run. Input is displayed only in the browser and discarded on reload.</p>
      <LayoutShowcase />
      <section data-component="Chat" className="reference-ui-example">
        <h3>Chat</h3>
        <p>A controlled conversation with its own input. A submitted message appears in the history.</p>
        <div className="reference-ui-chat"><Chat messages={messages} onSend={append} attachmentCapabilities={attachmentCapabilities} placeholder="Show message locally..." rows={2} /></div>
        <Button className="reference-ui-reset" onClick={() => setMessages(initialMessages)} variant="outline">Reset history</Button>
      </section>
      <section data-component="ChatMessages ChatInput" className="reference-ui-example">
        <h3>ChatMessages and ChatInput</h3>
        <p>The same parts can be placed separately. The input adds to the history below.</p>
        <ChatInput onSend={(text, attachments) => setDrafts((current) => [...current, localMessage(`draft-${current.length}`, text, attachments)])} attachmentCapabilities={attachmentCapabilities} placeholder="Try the separate input..." rows={2} />
        <div className="reference-ui-messages"><ChatMessages messages={drafts} emptyState={<p>No local input yet.</p>} /></div>
      </section>
      <section data-component="MessageList" className="reference-ui-example">
        <h3>Message list with multiple senders</h3>
        <p>The selection determines which sender appears without a speech bubble. The button adds to the local history.</p>
        <Select items={ownerOptions} value={feedOwner} onValueChange={(value) => setFeedOwner(value ?? "")}>
          <SelectTrigger aria-label="Sender without speech bubble"><SelectValue /></SelectTrigger>
          <SelectContent>{ownerOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
        <div className="reference-ui-messages"><MessageList messages={feed} owner={feedOwner || null} label="Local editorial notes" /></div>
        <Button onClick={() => setFeed((current) => [...current, {
          key: `note-${current.length}`, sender: current.length % 2 ? "Copy review" : "Editorial",
          text: `Local sample note ${current.length - 1}: This message was just added.`,
        }]) } variant="outline">Add local message</Button>
      </section>
      <section data-component="Select" className="reference-ui-example">
        <h3>Select</h3>
        <p>A choice among several values, composed from <code>Select</code>, <code>SelectTrigger</code>, <code>SelectValue</code>, <code>SelectContent</code>, and <code>SelectItem</code>; <code>items</code> supplies the labels, and <code>multiple</code> enables multiple selection.</p>
        <Select items={viewOptions} value={selection} onValueChange={(value) => { if (value !== null) setSelection(value); }}>
          <SelectTrigger aria-label="Local demo view"><SelectValue /></SelectTrigger>
          <SelectContent>{viewOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
        <p className="reference-ui-selection" aria-live="polite">Selected value: <code>{selection}</code></p>
      </section>
      <section data-component="Markdown" className="reference-ui-example">
        <h3>Markdown</h3>
        <label className="reference-ui-label" htmlFor="reference-markdown">Text to edit</label>
        <textarea id="reference-markdown" rows={6} value={markdown} onChange={(event) => setMarkdown(event.target.value)} />
        <div className="reference-ui-markdown"><Markdown text={markdown} /></div>
      </section>
      <ControlsShowcase />
      <ListDetailShowcase />
    </div>
  );
}

const root = document.getElementById("ui-showcase");
if (!root) throw new Error("The UI showcase requires the ui-showcase element.");
root.dataset.uiSurface = "mini-app";
createRoot(root).render(<Showcase />);
