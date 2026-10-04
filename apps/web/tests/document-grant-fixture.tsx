import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Markdown } from "quassel";
import { contentPathOf } from "../../../plugins/ragents.documents/contract";
import { DocumentPanel, type RunDocument } from "../../../plugins/ragents.documents/web/DocumentViewer";
import { useRunGrantsSettled } from "../../../plugins/ragents.documents/web/grants";
import { webPlugin } from "../../../plugins/ragents.documents/web/index";
import { documentBaseOf } from "../../../plugins/ragents.documents/web/links";
import { installAccessToken } from "../src/access-token";
import { RunUrls } from "../src/chat/QuasselHost";
import "../src/ui/tailwind.css";

const token = new URLSearchParams(location.search).get("access");
if (token) installAccessToken(token);
const prefix = "/api/plugins/ragents.documents";
const plugin = webPlugin.activate!({ routePrefix: prefix });

const stored = (id: string, title: string, format: RunDocument["format"], reference: string): RunDocument =>
  ({ id, title, format, contentUrl: contentPathOf(prefix, "run-1", reference), base: documentBaseOf(prefix, "run-1", reference) });

const documents: RunDocument[] = [
  stored("report", "report.html", "html", "@documents/review/report.html"),
  stored("notes", "notes.md", "markdown", "@documents/review/notes.md"),
  stored("shot", "home.png", "image", "@documents/review/shots/home.png"),
  stored("data", "data.zip", "binary", "@documents/review/data.zip"),
  { id: "plan", title: "Plan", format: "image", contentUrl: "/files/runs/run-1/artifacts/plan" },
];

/** The run as the Documents session provider holds it: its chat renders once the grants of its roots have settled. */
function Run({ children }: { children: ReactNode }) {
  return useRunGrantsSettled("run-1") ? children : null;
}

createRoot(document.getElementById("root")!).render(<div style={{ display: "grid", gap: 8 }}>
  {documents.map((entry) => <section aria-label={entry.title} key={entry.id} style={{ display: "flex", height: entry.format === "html" ? 400 : 160, width: 900 }}>
    <DocumentPanel activeId={entry.id} onSelect={() => {}} truncated={false} sections={[{ id: "store/review", label: "review", kind: "store", documents: [entry] }]} />
  </section>)}
  <section aria-label="Chat">
    <Run><RunUrls resolve={plugin.resolveRunUrl} runId="run-1"><Markdown text="![Chat shot](@documents/browser/x.png) and ![Logo](assets/logo.png)" /></RunUrls></Run>
  </section>
</div>);
