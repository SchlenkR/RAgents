import { isClipboardRunPanelMessage } from "./host-contract";

type EditingAction = "paste" | "copy" | "cut";

const actionOf = (event: KeyboardEvent): EditingAction | undefined => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return undefined;
  switch (event.key) {
    case "v": return "paste";
    case "c": return "copy";
    case "x": return "cut";
    default: return undefined;
  }
};

const isEditable = (element: Element | null): element is HTMLElement =>
  element !== null && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || (element as HTMLElement).isContentEditable === true);

/**
 * macOS liefert Einfügen, Kopieren und Ausschneiden über das Menü der Anwendung, und VS Code reicht
 * den Befehl nur an das Dokument seines Webviews weiter, nicht in ein iframe fremder Herkunft. Das
 * Run-Panel führt ihn deshalb selbst aus; den Text der Zwischenablage holt es über die Hülle.
 */
export function installClipboardBridge(browser: Window): () => void {
  const parent = browser.parent;
  const pending = new Map<string, (text: string) => void>();

  const onMessage = (event: MessageEvent) => {
    if (event.source !== parent || !isClipboardRunPanelMessage(event.data)) return;
    const settle = pending.get(event.data.id);
    if (!settle) return;
    pending.delete(event.data.id);
    settle(event.data.text);
  };

  const read = () => new Promise<string>((resolve) => {
    const id = crypto.randomUUID();
    pending.set(id, resolve);
    parent.postMessage({ type: "clipboardRead", id }, "*");
  });

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
    void read().then((text) => {
      if (!text || !isEditable(target)) return;
      target.focus();
      browser.document.execCommand("insertText", false, text);
    });
  };

  browser.addEventListener("message", onMessage);
  browser.addEventListener("keydown", onKeyDown, true);
  return () => {
    browser.removeEventListener("message", onMessage);
    browser.removeEventListener("keydown", onKeyDown, true);
  };
}
