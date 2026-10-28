import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { ChatInputToolbar, ChatMessages, ChatPanel, type Message } from "@schlenkr/quassel";
import { QuasselHost } from "../src/chat/QuasselHost";
import { RunPanelHostProvider, type RunPanelHost } from "../src/run-panel/host";
import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../src/ui";
import { QuestionCard } from "../../../plugins/ragents.ask/web/QuestionCard";
import { DocumentPanel } from "../../../plugins/ragents.documents/web/DocumentViewer";
import { FileBrowserPanel } from "../../../plugins/ragents.workspace/web/FileBrowser";
import { PluginRegistry, type SessionContext } from "../src/PluginRegistry";
import { RunPanelHeader } from "../src/run-panel/RunPanelHeader";
import { bindHostTypography } from "../src/zoom";
import "../src/ui/tailwind.css";

const requestedHost = new URLSearchParams(location.search).get("host") ?? "browser";
if (requestedHost !== "browser" && requestedHost !== "vscode") throw new Error("Unknown fixture host.");
document.documentElement.dataset.host = requestedHost;
if (requestedHost === "vscode") bindHostTypography(window);

const host: RunPanelHost = {
  kind: requestedHost,
  machines: requestedHost === "browser" ? "server" : "all",
  openApp() {}, requestLogin() {}, requestLogout() {}, openExternal() {}, openPage() {}, openService() {},
  onCommand: () => () => {}, notify() {},
};
const messages: Message[] = [
  {
    key: "guide", role: "assistant", sender: "guide", closed: true, at: "2026-01-10T10:00:00.000Z",
    text: "# Chat heading 1\n\nChat reading paragraph.\n\n- Chat list item.\n\n> Chat quotation.\n\n## Chat heading 2\n\n### Chat heading 3\n\n#### Chat heading 4\n\n##### Chat heading 5\n\n###### Chat heading 6",
  },
  {
    key: "reader", role: "user", sender: "reader", closed: true, at: "2026-01-10T10:01:00.000Z",
    text: "# User heading 1\n\nUser reading paragraph.",
  },
  {
    key: "helper", role: "assistant", sender: "helper", closed: true, at: "2026-01-10T10:02:00.000Z",
    bubble: { label: "Helper", side: "start", color: "var(--primary)" },
    text: "# Bubble heading 1\n\nBubble reading paragraph.",
  },
  ...Array.from({ length: 24 }, (_, index): Message => ({
    key: `note-${index}`, role: "assistant", sender: "guide", closed: true, at: "2026-01-10T10:03:00.000Z",
    text: `Reading note ${index + 1}. ${"Longer conversations remain scrollable while the composer stays available. ".repeat(3)}`,
  })),
];

declare global { interface Window { typographyFixture: { append(): void } } }

function Examples() {
  const [conversation, setConversation] = useState(messages);
  useEffect(() => {
    window.typographyFixture = { append: () => setConversation((current) => [...current, {
      key: `arrival-${current.length}`, role: "assistant", sender: "guide", closed: true, text: "A newly arriving reading note.",
    }]) };
  }, []);
  return <RunPanelHostProvider value={host}><QuasselHost>
  <main className="grid h-full min-h-0 grid-cols-2 grid-rows-[auto_minmax(0,1fr)_auto] gap-4 p-4">
    <header className="col-span-2 flex items-center justify-between gap-4">
      <p className="type-title">Reading examples</p>
      <span className="type-meta">{requestedHost === "browser" ? "Browser" : "VS Code"}</span>
    </header>
    <section aria-label="Chat" className="flex min-h-0 min-w-0 flex-col">
      <ChatPanel composer={<ChatInputToolbar attachments={false} initialValue="A composer uses the same reading size." onSend={() => {}} rows={2} texts={{ placeholder: "Write a message ..." }} />}>
        <ChatMessages messages={conversation} owner="guide" showTimestamps />
      </ChatPanel>
    </section>
    <article aria-label="Document" className="type-prose min-h-0 min-w-0 overflow-auto rounded-lg border border-border bg-card p-4">
      <h1>Document heading 1</h1>
      <p>Document reading paragraph.</p>
      <ul><li>Document list item.</li></ul>
      <blockquote>Document quotation.</blockquote>
      <h2>Document heading 2</h2>
      <h3>Document heading 3</h3>
      <h4>Document heading 4</h4>
      <h5>Document heading 5</h5>
      <h6>Document heading 6</h6>
    </article>
    <section aria-label="Controls and metadata" className="col-span-2 flex items-center gap-4 rounded-lg border border-border bg-card p-4">
      <Button>Example action</Button>
      <p className="type-body">Body control text.</p>
      <p className="type-meta">Metadata text.</p>
    </section>
  </main>
</QuasselHost></RunPanelHostProvider>;
}

const markdown = "# Review notes\n\nA shared document uses readable paragraphs, a list and code.\n\n- Review the current changes.\n- Record the result.\n\nUse `readFile` to inspect a file.\n\n~~~ts\nconst result = readFile(\"notes.md\");\n~~~\n\n## Next actions\n\n### Details\n\n#### Context\n\n> Keep the report concise.";
const scaleMessages: Message[] = [
  { key: "request", role: "user", text: "Please review the changes.", closed: true, at: "2026-10-28T10:00:00Z" },
  { key: "answer", role: "assistant", text: markdown, closed: true, at: "2026-10-28T10:01:00Z" },
  { key: "inspect", role: "tool", text: "Inspect files", closed: true, tool: { id: "inspect", name: "inspect_files", arguments: "{}", result: "Ready" } },
  { key: "notice", role: "system", text: "New turn", closed: true },
  { key: "action", role: "action", text: "Approve the review", closed: true, action: { actionId: "review", owner: "example", payload: null } },
];
const registry = new PluginRegistry({ brand: { title: "Examples" }, product: { id: "examples", title: "Examples" }, startEntries: [], plugins: [] }, new Map());
const session: SessionContext = {
  connected: true, pluginEvents: [], runView: undefined, running: false, messages: [],
  session: { id: "reading", title: "Review conversation", updatedAt: 0 },
  send: async () => {}, start: async () => {},
};
const navigation = { activeTabId: "", openTab() {}, revealEntity: () => false, selectionFor: () => undefined };

function ScaleExamples() {
  return <RunPanelHostProvider value={host}><QuasselHost><main className="grid h-full min-h-0 grid-cols-2 grid-rows-[auto_minmax(0,1fr)] gap-4 p-4">
    <header className="col-span-2 flex items-center gap-4">
      <RunPanelHeader attention={undefined} contributions={[]} navigation={navigation} registry={registry} runError={undefined} session={session} working={false} />
      <Badge>Ready</Badge>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" />}>Reading menu</DropdownMenuTrigger>
        <DropdownMenuContent><DropdownMenuItem>Open notes</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
    </header>
    <section aria-label="Chat" className="flex min-h-0 min-w-0 flex-col gap-4">
      <div className="min-h-0 flex-1"><ChatPanel composer={<ChatInputToolbar initialValue="A composer uses the same reading size." onSend={() => {}} />}>
        <ChatMessages detailMode="full" messages={scaleMessages} owner="guide" showTimestamps />
      </ChatPanel></div>
      <QuestionCard questions={[{ header: "Period", question: "Which review period applies?", multiSelect: false,
        options: [{ label: "3 days", description: "Review this week" }, { label: "14 days", description: "Review after the next update" }] }]} onAnswer={() => {}} />
    </section>
    <div className="grid min-h-0 min-w-0 grid-rows-2 gap-4">
      <article aria-label="Document" className="min-h-0 min-w-0 overflow-auto rounded-lg border border-border bg-card p-4">
        <DocumentPanel activeId="notes" onSelect={() => {}} truncated={false} sections={[{ id: "notes", label: "Notes", kind: "chat", documents: [{ id: "notes", title: "notes.md", format: "markdown", content: markdown }] }]} />
      </article>
      <section aria-label="File preview" className="min-h-0 min-w-0 overflow-hidden rounded-lg border border-border bg-card">
        <FileBrowserPanel active navigation={navigation} selection={undefined} session={session} />
      </section>
    </div>
  </main></QuasselHost></RunPanelHostProvider>;
}

createRoot(document.getElementById("root")!).render((new URLSearchParams(location.search).has("scale") || new URLSearchParams(location.search).get("element") === "scale") ? <ScaleExamples /> : <Examples />);
