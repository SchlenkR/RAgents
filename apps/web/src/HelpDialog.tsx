import { useEffect, useRef } from "react";
import { XIcon } from "lucide-react";
import { Button, Dialog, DialogContent, DialogTitle } from "./ui";
import { helpSampleRequest } from "./help-samples";

export function HelpDialog({ onClose, sampleEntries, onStartSample }: {
  onClose: () => void;
  sampleEntries: readonly string[];
  onStartSample: (entry: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const cleanupRef = useRef<(() => void) | undefined>(undefined);
  const launching = useRef(false);
  useEffect(() => () => cleanupRef.current?.(), []);
  useEffect(() => {
    const frame = frameRef.current?.contentWindow;
    if (!frame) return;
    const announce = () => frame.postMessage({ type: "ragents:help-context", canStartSamples: sampleEntries.length > 0,
      entries: sampleEntries }, window.location.origin);
    const receive = (event: MessageEvent) => {
      const request = helpSampleRequest(event, frame, window.location.origin, sampleEntries);
      if (request?.type === "ready") announce();
      if (request?.type === "start" && !launching.current) {
        launching.current = true;
        onStartSample(request.entry);
      }
    };
    window.addEventListener("message", receive);
    announce();
    return () => window.removeEventListener("message", receive);
  }, [onStartSample, sampleEntries]);

  const connectFrame = () => {
    cleanupRef.current?.();
    const frame = frameRef.current;
    const document = frame?.contentDocument;
    const view = document?.defaultView;
    if (!frame || !document || !view) return;
    document.documentElement.dataset.helpEmbedded = "true";

    for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if (new URL(link.href).origin !== window.location.origin) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab") {
        const elements = [...document.querySelectorAll<HTMLElement>(
          "a[href], button, input, select, textarea, summary, [tabindex]",
        )].filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
        const boundary = event.shiftKey ? elements[0] : elements.at(-1);
        if (!elements.length || document.activeElement === boundary || document.activeElement === document.body) {
          if (!event.shiftKey && document.activeElement === document.body && elements.length) return;
          event.preventDefault();
          closeRef.current?.focus();
        }
      }
    };
    view.addEventListener("keydown", handleKey);
    cleanupRef.current = () => view.removeEventListener("keydown", handleKey);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="gap-0 p-0" initialFocus={closeRef} scope="page" showCloseButton={false} size="full">
      <DialogTitle className="sr-only">Hilfe</DialogTitle>
      <Button aria-label="Hilfe schließen" className="absolute top-3 right-4.5 z-1 rounded-full" onClick={onClose} ref={closeRef} size="icon" variant="outline">
        <XIcon />
      </Button>
      <iframe
        className="min-h-0 w-full min-w-0 flex-[1_1_0] bg-background"
        onLoad={connectFrame}
        ref={frameRef}
        src={`${import.meta.env.BASE_URL}help/index.html`}
        tabIndex={0}
        title="RAgents: Homepage und Dokumentation"
      />
    </DialogContent>
    </Dialog>
  );
}
