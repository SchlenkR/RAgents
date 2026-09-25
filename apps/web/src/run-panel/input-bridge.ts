import { createClipboardReader, installClipboardBridge } from "./clipboard";
import { installKeyboardBridge } from "./keyboard";
import { isClipboardRunPanelMessage, isRunPanelClipboardMessage, isRunPanelKeyboardMessage, type ClipboardRunPanelMessage, type RunPanelKeyboardMessage } from "./host-contract";

export { keyboardMessage } from "./keyboard";
export { isRunPanelKeyboardMessage } from "./host-contract";

interface InputTransport {
  readClipboard: () => Promise<string>;
  keyboard: (message: RunPanelKeyboardMessage) => void;
}

const serviceKey = Symbol.for("ragents.host-input");
const inputType = "ragents.app.input";
type InputWindow = Window & { [key: symbol]: InputTransport | undefined };
const transportOf = (browser: Window) => (browser as InputWindow)[serviceKey];
export const hostInputEnabled = (browser: Window): boolean => transportOf(browser) !== undefined;

function installInputTransport(browser: Window, transport: InputTransport): () => void {
  if (hostInputEnabled(browser)) throw new Error("Die Eingabebrücke ist bereits installiert.");
  (browser as InputWindow)[serviceKey] = transport;
  const clipboard = installClipboardBridge(browser, transport.readClipboard);
  const keyboard = installKeyboardBridge(browser, transport.keyboard);
  return () => {
    clipboard();
    keyboard();
    delete (browser as InputWindow)[serviceKey];
  };
}

export function installRunPanelInputBridge(browser: Window): () => void {
  const reader = createClipboardReader(browser);
  const dispose = installInputTransport(browser, {
    readClipboard: reader.read,
    keyboard: (message) => browser.parent.postMessage(message, "*"),
  });
  return () => { dispose(); reader.dispose(); };
}

export function relayFrameInput(browser: Window, value: unknown, reply: (message: ClipboardRunPanelMessage) => void): boolean {
  if (!value || typeof value !== "object" || !("type" in value) || value.type !== inputType) return false;
  if (!("version" in value) || value.version !== 1 || !("message" in value)) return true;
  const transport = transportOf(browser);
  if (!transport) return true;
  const message = value.message;
  if (isRunPanelKeyboardMessage(message)) transport.keyboard(message);
  else if (isRunPanelClipboardMessage(message)) void transport.readClipboard().then((text) => reply({ type: "clipboardText", id: message.id, text }));
  return true;
}

export function installFrameInputBridge(browser: Window, port: MessagePort): () => void {
  const pending = new Map<string, (text: string) => void>();
  const onMessage = ({ data }: MessageEvent) => {
    if (!isClipboardRunPanelMessage(data)) return;
    const settle = pending.get(data.id);
    pending.delete(data.id);
    settle?.(data.text);
  };
  port.addEventListener("message", onMessage);
  const send = (message: unknown) => port.postMessage({ type: inputType, version: 1, message });
  const dispose = installInputTransport(browser, {
    readClipboard: () => new Promise<string>((resolve) => {
      const id = crypto.randomUUID();
      pending.set(id, resolve);
      send({ type: "clipboardRead", id });
    }),
    keyboard: (message) => { if (message.event.key !== "Escape" || message.event.type === "keyup") send(message); },
  });
  return () => {
    dispose();
    port.removeEventListener("message", onMessage);
    pending.forEach((settle) => settle(""));
    pending.clear();
  };
}
