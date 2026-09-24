import type { RunPanelKeyboardMessage } from "./host-contract";

const isLocalEditingKey = (event: KeyboardEvent, element: Element | null): boolean => {
  const editable = element !== null && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || (element as HTMLElement).isContentEditable);
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && ["c", "v", "x"].includes(key)) return true;
  if (!editable) return false;
  if (!(event.altKey && (event.metaKey || event.ctrlKey))
    && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Backspace", "Delete"].includes(event.key)) return true;
  return (event.metaKey || event.ctrlKey) && !event.altKey && (key === "z" || (!event.shiftKey && ["a", "y"].includes(key)));
};

export function installKeyboardBridge(browser: Window): () => void {
  const forwarded = new Set<string>();
  const post = (event: KeyboardEvent, type: "keydown" | "keyup") => {
    const message: RunPanelKeyboardMessage = {
      type: "keyboardEvent",
      event: {
        type,
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        repeat: event.repeat,
      },
    };
    browser.parent.postMessage(message, "*");
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229
      || event.key === "Dead" || event.key === "Process" || event.getModifierState("AltGraph")
      || isLocalEditingKey(event, browser.document.activeElement)) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && ["p", "f", "s"].includes(event.key.toLowerCase())) event.preventDefault();
    forwarded.add(event.code || event.key);
    post(event, "keydown");
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (!forwarded.delete(event.code || event.key)) return;
    post(event, "keyup");
  };
  const onBlur = () => forwarded.clear();
  browser.addEventListener("keydown", onKeyDown);
  browser.addEventListener("keyup", onKeyUp);
  browser.addEventListener("blur", onBlur);
  return () => {
    browser.removeEventListener("keydown", onKeyDown);
    browser.removeEventListener("keyup", onKeyUp);
    browser.removeEventListener("blur", onBlur);
    forwarded.clear();
  };
}
