import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { ChatInputToolbar, ChatMessages, ChatPanel, type Message } from "quassel";
import "../src/ui/tailwind.css";
import { QuasselHost } from "../src/chat/QuasselHost";

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
    text: `Message ${index}. ${"A longer paragraph for checking the reading position. ".repeat(12)}`,
  })),
  update() {
    flushSync(() => root.render(
      <StrictMode><QuasselHost>
      <ChatPanel scrollOnSend={fixture.scrollOnSend} composer={
        <ChatInputToolbar key={fixture.composerKey} sendShortcut={fixture.sendShortcut} onSend={async (text) => {
          if (fixture.rejectSend) throw new Error("Sending failed");
          fixture.sent.push(text);
          fixture.messages = [...fixture.messages, { key: `sent-${fixture.sent.length}`, role: "user", text }];
          fixture.update();
          if (fixture.holdCompletion) await new Promise<void>((resolve) => { fixture.completeSend = resolve; });
        }} />
      }>
        <ChatMessages messages={fixture.messages} messageActions={{ custom: (message) => message.key === "19" ? [
          { id: "success", label: "Run action", onClick: () => { fixture.clicked.push(message.key); } },
          { id: "failure", label: "Trigger error", onClick: async () => { throw new Error("Action failed"); } },
        ] : [] }} />
      </ChatPanel>
      </QuasselHost></StrictMode>,
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
