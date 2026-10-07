import { createRoot } from "react-dom/client";
import { ChatMessages, QuasselProvider, type DetailMode, type Message } from "quassel";
import { QuasselHost } from "../src/chat/QuasselHost";
import "../src/ui/tailwind.css";

const options = new URLSearchParams(location.search);
const detailMode = options.get("mode") as DetailMode;
const paragraphs = Array.from({ length: 120 }, (_, index) => `Thought ${index + 1}: Compare the current evidence, check the assumptions, and describe the next useful action. This paragraph keeps the trace long enough to require scrolling.`).join("\n\n");
const messages: Message[] = [
  { key: "question", role: "user", text: "Review the sample project." },
  { key: "thinking", role: "thinking", text: `${paragraphs}\n\nEnd of thinking trace.`, closed: true },
  { key: "tool", role: "tool", text: "Read project notes", tool: { id: "read", name: "read", arguments: '{"file_path":"notes.md"}', result: `${paragraphs}\n\nEnd of tool result.` } },
  { key: "answer", role: "assistant", text: "The project review is complete.", closed: true },
];
const content = <main className="flex h-dvh flex-col justify-end bg-background p-4 text-foreground">
  <h1 className="mb-2 text-base">Project review</h1>
  <section aria-label="Project chat" className="flex h-48 min-h-0 flex-col">
    <ChatMessages messages={messages} detailMode={detailMode} />
  </section>
</main>;

document.documentElement.dataset.theme = "dark";
createRoot(document.getElementById("root")!).render(options.get("host") === "ragents"
  ? <QuasselHost>{content}</QuasselHost>
  : <QuasselProvider>{content}</QuasselProvider>);
