import { isClipboardRunPanelMessage, type ClipboardContent, type RunPanelClipboardMessage } from "./host-contract";

type EditingAction = "paste" | "copy" | "cut";

const actionOf = (event: KeyboardEvent): EditingAction | undefined => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing || event.keyCode === 229 || event.getModifierState?.("AltGraph")) return undefined;
  switch (event.key.toLowerCase()) {
    case "v": return "paste";
    case "c": return "copy";
    case "x": return "cut";
    default: return undefined;
  }
};

const isEditable = (element: Element | null): element is HTMLElement =>
  element !== null && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || (element as HTMLElement).isContentEditable === true);

/** The parent reads the clipboard on request; its answer always arrives as a message from the parent window. */
export function createClipboardReader(browser: Window, request: (message: RunPanelClipboardMessage) => void = (message) => browser.parent.postMessage(message, "*")) {
  const parent = browser.parent;
  const pending = new Map<string, (content: ClipboardContent) => void>();

  const onMessage = (event: MessageEvent) => {
    if (event.source !== parent || !isClipboardRunPanelMessage(event.data)) return;
    const settle = pending.get(event.data.id);
    if (!settle) return;
    pending.delete(event.data.id);
    settle({ text: event.data.text, files: event.data.files });
  };

  const read = () => new Promise<ClipboardContent>((resolve) => {
    const id = crypto.randomUUID();
    pending.set(id, resolve);
    request({ type: "clipboardRead", id });
  });

  browser.addEventListener("message", onMessage);
  return {
    read,
    dispose: () => { browser.removeEventListener("message", onMessage); pending.forEach((settle) => settle({ text: "", files: [] })); pending.clear(); },
  };
}

export function installClipboardBridge(browser: Window, readClipboard?: () => Promise<ClipboardContent>): () => void {
  let active = true;
  const reader = readClipboard ? undefined : createClipboardReader(browser);
  const read = readClipboard ?? reader!.read;
  const onKeyDown = (event: KeyboardEvent) => {
    const action = actionOf(event);
    if (action === undefined || event.defaultPrevented) return;
    const target = browser.document.activeElement;
    if (action !== "copy" && !isEditable(target)) return;
    event.preventDefault();
    if (action !== "paste") {
      browser.document.execCommand(action);
      return;
    }
    void read().then(({ text, files }) => {
      if (!active || !isEditable(target) || !target.isConnected) return;
      browser.focus();
      target.focus();
      if (files.length > 0) {
        const clipboardData = new DataTransfer();
        for (const file of files) clipboardData.items.add(file);
        clipboardData.setData("text/plain", text);
        if (!target.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }))) return;
      }
      if (text) browser.document.execCommand("insertText", false, text);
    });
  };

  browser.addEventListener("keydown", onKeyDown, true);
  return () => {
    active = false;
    reader?.dispose();
    browser.removeEventListener("keydown", onKeyDown, true);
  };
}
