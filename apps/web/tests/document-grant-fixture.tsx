import { createRoot } from "react-dom/client";
import { contentPathOf } from "../../../plugins/ragents.documents/contract";
import { DocumentPanel } from "../../../plugins/ragents.documents/web/DocumentViewer";
import { documentBaseOf } from "../../../plugins/ragents.documents/web/links";
import { installAccessToken } from "../src/access-token";
import "../src/ui/tailwind.css";

const token = new URLSearchParams(location.search).get("access");
if (token) installAccessToken(token);
const prefix = "/api/plugins/ragents.documents";
const reference = "@documents/review/report.html";

createRoot(document.getElementById("root")!).render(<div style={{ display: "flex", height: 600, width: 900 }}>
  <DocumentPanel activeId="report" onSelect={() => {}} truncated={false} sections={[{ id: "store/review", label: "review", kind: "store", documents: [
    { id: "report", title: "report.html", format: "html", contentUrl: contentPathOf(prefix, "run-1", reference), base: documentBaseOf(prefix, "run-1", reference) },
  ] }]} />
</div>);
