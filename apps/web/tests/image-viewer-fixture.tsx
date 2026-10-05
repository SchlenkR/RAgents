import { createRoot } from "react-dom/client";
import { ChatMessages, Markdown } from "quassel";
import { DocumentPanel } from "../../../plugins/ragents.documents/web/DocumentViewer";
import { QuasselHost } from "../src/chat/QuasselHost";
import { ImagePreview } from "../src/ui";
import "../src/ui/tailwind.css";

document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") ?? "light";

createRoot(document.getElementById("root")!).render(<QuasselHost>
  <main className="min-h-screen bg-background p-6 text-foreground">
    <h1 className="mb-4 text-xl">Project images</h1>
    <section aria-label="Preview" className="w-96"><ImagePreview className="max-w-full" fileName="landscape.svg" src="/landscape.svg" /></section>
    <section aria-label="Documents" className="mt-4 h-56 w-[600px]">
      <DocumentPanel activeId="image" onSelect={() => {}} sections={[{ id: "images", kind: "store", label: "Images", documents: [{ id: "image", title: "document.svg", format: "image", contentUrl: "/landscape.svg" }] }]} truncated={false} />
    </section>
    <section aria-label="Markdown" className="mt-4 w-96"><Markdown text="![Landscape](/landscape.svg)" /></section>
    <section aria-label="Chat attachments" className="mt-4 h-56 w-96"><ChatMessages messages={[{ key: "attachment", role: "user", text: "Review this image", attachments: [{ name: "attachment.svg", mediaType: "image/svg+xml", url: "/landscape.svg", size: 1000 }] }]} /></section>
  </main>
</QuasselHost>);
