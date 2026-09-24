import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { ChatInputToolbar } from "../src/chat/ChatInputToolbar";
import { ChatMessages } from "../src/chat/ChatMessages";
import { ChatPanel } from "../src/chat/ChatPanel";
import type { Message } from "../src/chat/types";
import "../src/ui/tailwind.css";

const root = createRoot(document.getElementById("app")!);
const fixture = {
  sendShortcut: "enter" as "enter" | "mod-enter",
  scrollOnSend: false,
  rejectSend: false,
  composerKey: 0,
  holdCompletion: false,
  completeSend: undefined as (() => void) | undefined,
  sent: [] as string[],
  clicked: [] as string[],
  messages: Array.from({ length: 20 }, (_, index): Message => ({
    key: String(index), role: "assistant", closed: true,
    text: `Nachricht ${index}. ${"Ein längerer Absatz für die Prüfung der Leseposition. ".repeat(12)}`,
  })),
  update() {
    flushSync(() => root.render(
      <StrictMode>
      <ChatPanel scrollOnSend={fixture.scrollOnSend} composer={
        <ChatInputToolbar key={fixture.composerKey} sendShortcut={fixture.sendShortcut} onSend={async (text) => {
          if (fixture.rejectSend) throw new Error("Senden fehlgeschlagen");
          fixture.sent.push(text);
          fixture.messages = [...fixture.messages, { key: `sent-${fixture.sent.length}`, role: "user", text }];
          fixture.update();
          if (fixture.holdCompletion) await new Promise<void>((resolve) => { fixture.completeSend = resolve; });
        }} />
      }>
        <ChatMessages messages={fixture.messages} messageActions={{ custom: (message) => message.key === "19" ? [
          { id: "success", label: "Aktion ausführen", onClick: () => { fixture.clicked.push(message.key); } },
          { id: "failure", label: "Fehler auslösen", onClick: async () => { throw new Error("Aktion fehlgeschlagen"); } },
        ] : [] }} />
      </ChatPanel>
      </StrictMode>,
    ));
  },
};

declare global {
  interface Window {
    chatFixture: typeof fixture;
  }
}

window.chatFixture = fixture;
fixture.update();
