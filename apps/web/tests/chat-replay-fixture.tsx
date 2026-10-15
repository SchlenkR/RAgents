import { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { ChatMessages, type ChatEvent } from "@schlenkr/quassel";
import { QuasselHost } from "../src/chat/QuasselHost";
import { useChat } from "../src/chat/useChat";
import "../src/ui/tailwind.css";

const subscriptions = new Set<{ message: (event: ChatEvent) => void; error: () => void }>();
const fixture = {
  observed: [] as ChatEvent[],
  renders: [] as { connected: boolean; texts: string[] }[],
  send(event: ChatEvent) { subscriptions.forEach(({ message }) => message(event)); },
  disconnect() { subscriptions.forEach(({ error }) => error()); },
  subscribe(_contract: unknown, _params: unknown, message: (event: ChatEvent) => void, error: () => void) {
    const subscription = { message, error };
    subscriptions.add(subscription);
    return () => { subscriptions.delete(subscription); };
  },
};

function Chat() {
  const chat = useChat("demo", (event) => fixture.observed.push(event));
  useLayoutEffect(() => { fixture.renders.push({ connected: chat.connected, texts: chat.messages.map(({ text }) => text) }); });
  return <main className="flex h-full flex-col bg-background text-foreground">
    <output aria-label="Connection">{chat.connected ? "Connected" : "Connecting"}</output>
    <QuasselHost><ChatMessages detailMode="full" messages={chat.messages} running={chat.running} /></QuasselHost>
  </main>;
}

declare global {
  interface Window { chatReplayFixture: typeof fixture; }
}

window.chatReplayFixture = fixture;
createRoot(document.getElementById("root")!).render(<Chat />);
