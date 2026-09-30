import { createClipboardReader, installClipboardBridge } from "./clipboard";
import { installKeyboardBridge } from "./keyboard";
import { isClipboardRunPanelMessage, isRunPanelClipboardMessage, isRunPanelKeyboardMessage, type ClipboardContent, type ClipboardRunPanelMessage, type RunPanelKeyboardMessage } from "./host-contract";

export { keyboardMessage } from "./keyboard";
export { isRunPanelKeyboardMessage } from "./host-contract";

interface InputTransport {
  readClipboard: () => Promise<ClipboardContent>;
  keyboard: (message: RunPanelKeyboardMessage) => void;
}

const serviceKey = Symbol.for("ragents.host-input");
const inputType = "ragents.app.input";
type InputWindow = Window & { [key: symbol]: InputTransport | undefined };
const transportOf = (browser: Window) => (browser as InputWindow)[serviceKey];
export const hostInputEnabled = (browser: Window): boolean => transportOf(browser) !== undefined;

function installInputTransport(browser: Window, transport: InputTransport): () => void {
  if (hostInputEnabled(browser)) throw new Error("The input bridge is already installed.");
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
  else if (isRunPanelClipboardMessage(message)) {
    const frame = browser.document.activeElement;
    void transport.readClipboard().then((content) => {
      if (transportOf(browser) === transport && frame?.tagName === "IFRAME" && frame.isConnected) {
        (frame as HTMLIFrameElement).focus({ preventScroll: true });
      }
      reply({ type: "clipboardContent", id: message.id, ...content });
    });
  }
  return true;
}

export function installFrameInputBridge(browser: Window, port: MessagePort): () => void {
  const pending = new Map<string, (content: ClipboardContent) => void>();
  const onMessage = ({ data }: MessageEvent) => {
    if (!isClipboardRunPanelMessage(data)) return;
    const settle = pending.get(data.id);
    pending.delete(data.id);
    settle?.({ text: data.text, files: data.files });
  };
  port.addEventListener("message", onMessage);
  const send = (message: unknown) => port.postMessage({ type: inputType, version: 1, message });
  const dispose = installInputTransport(browser, {
    readClipboard: () => new Promise<ClipboardContent>((resolve) => {
      const id = crypto.randomUUID();
      pending.set(id, resolve);
      send({ type: "clipboardRead", id });
    }),
    keyboard: (message) => { if (message.event.key !== "Escape" || message.event.type === "keyup") send(message); },
  });
  return () => {
    dispose();
    port.removeEventListener("message", onMessage);
    pending.forEach((settle) => settle({ text: "", files: [] }));
    pending.clear();
  };
}
