import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { ChannelContract, ChannelMessage, ChannelParams } from "@ragents/engine/src/rpc/contract";
import { DocumentPanel, type RunDocument } from "../../../plugins/ragents.documents/web/DocumentViewer";
import { documentBaseOf } from "../../../plugins/ragents.documents/web/links";
import { webPlugin } from "../../../plugins/ragents.documents/web/index";
import { FileBrowserPanel } from "../../../plugins/ragents.workspace/web/FileBrowser";
import type { SessionContext, WorkspaceTabContext } from "../src/PluginRegistry";
import { rpc } from "../src/rpc";
import "../src/ui/tailwind.css";

declare global {
  interface Window {
    emitFiles: (root: "files" | "workspace") => void;
    reconnect: () => void;
    setVisible: (visible: boolean) => void;
    setBrowserActive: (active: boolean) => void;
  }
}

const subscriptions = new Set<{ channel: string; root?: string; changed: () => void }>();
const connected = new Set<() => void>();
rpc.subscribe = <C extends ChannelContract>(contract: C, params: ChannelParams<C>, onMessage: (message: ChannelMessage<C>) => void) => {
  const entry = { channel: contract.id, root: (params as { root?: string }).root, changed: () => onMessage({ changed: true } as ChannelMessage<C>) };
  subscriptions.add(entry);
  return () => { subscriptions.delete(entry); };
};
rpc.onConnected = (listener) => {
  connected.add(listener);
  return () => { connected.delete(listener); };
};
rpc.call = (async (contract, input, options) => {
  const response = await fetch("/fixture/rpc", { method: "POST", body: JSON.stringify({ method: contract.id, input }), signal: options?.signal });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}) as typeof rpc.call;
window.emitFiles = (root) => {
  for (const entry of subscriptions) {
    if (entry.root === root || root === "files" && entry.channel === "ragents.documents.changed") entry.changed();
  }
};
window.reconnect = () => { for (const listener of connected) listener(); };
window.setVisible = (visible) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: visible ? "visible" : "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
};

const prefix = "/api/plugins/ragents.documents";
const stored = (id: string, format: RunDocument["format"], reference = `@documents/${id}`): RunDocument => ({
  id, title: id, format, contentUrl: `${prefix}/runs/run-1/raw/${reference}`,
  base: documentBaseOf(prefix, "run-1", reference),
});
const documents: RunDocument[] = [
  stored("report.md", "markdown"),
  stored("plain.txt", "text"),
  stored("site.html", "html"),
  stored("image.svg", "image"),
  stored("data.bin", "binary"),
  stored("workspace.md", "markdown", "workspace.md"),
  { id: "standalone", title: "standalone", format: "text", contentUrl: "/standalone.txt" },
  { id: "inline", title: "inline", format: "markdown", content: "# Inline document" },
];
const session = { session: { id: "run-1" }, messages: [] } as unknown as SessionContext;
const plugin = webPlugin.activate!({ routePrefix: prefix });
const Provider = plugin.SessionProvider!;
const StorePanel = plugin.workspaceTabs![0]!.Panel;

function Store() {
  const [selection, setSelection] = useState<unknown>();
  const navigation = { openTab: (_id: string, value: unknown) => setSelection(value) } as WorkspaceTabContext["navigation"];
  return <Provider session={session}><StorePanel {...{ active: true, session, navigation, selection } as WorkspaceTabContext} /></Provider>;
}

function App() {
  const [active, setActive] = useState(true);
  window.setBrowserActive = setActive;
  return <main className="grid grid-cols-2 gap-3 p-3">
    {documents.map((entry) => <section aria-label={entry.title} className="flex h-60 min-h-0 border" key={entry.id}>
      <DocumentPanel activeId={entry.id} onSelect={() => {}} truncated={false} sections={[{ id: "store", label: "Store", kind: "store", documents: [entry] }]} />
    </section>)}
    {["Files A", "Files B"].map((label) => <section aria-label={label} className="h-110 border" key={label}>
      <FileBrowserPanel {...{ active, session } as WorkspaceTabContext} />
    </section>)}
    <section aria-label="Document store" className="h-110 border"><Store /></section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
