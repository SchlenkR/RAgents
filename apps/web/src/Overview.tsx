import { useCallback, useEffect, useRef, type ComponentType } from "react";
import { Card, DialogTitle } from "./ui";
import { Modal } from "./ui/modal";
import type { OverviewPanelContext, OverviewPanelContribution, PluginRegistry } from "./PluginRegistry";

interface OverviewProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  registry: PluginRegistry;
  panels: readonly OverviewPanelContribution[];
  onBusy: (id: string, busy: boolean) => void;
}

const FOCUSABLE_SELECTOR =
  "button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

const overviewSurfaceClass = "pointer-events-auto shadow-pop";

/** The shared shell opens contributions placed in the overview. */
export function Overview({ onBusy, onClose, onOpen, open, panels, registry }: OverviewProps) {
  const overviewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const overview = overviewRef.current;
      if (!overview || overview.contains(document.activeElement)) return;
      overview.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <Modal className="pointer-events-none flex h-[min(900px,100%)] w-[min(1440px,100%)] flex-col rounded-none bg-transparent p-0 ring-0" keepMounted onClose={onClose} open={open} scope="workspace" size="full">
      <DialogTitle className="sr-only">Overview</DialogTitle>
      <div className="flex min-h-0 min-w-0 flex-1 gap-4 max-[900px]:flex-col" id="app-overview" ref={overviewRef}>
      {panels.map(({ id, Panel }) => (
        <OverviewPanelHost id={id} key={id} onBusy={onBusy} onClose={onClose} onOpen={onOpen} open={open} Panel={Panel} registry={registry} />
      ))}
      </div>
    </Modal>
  );
}

function OverviewPanelHost({ id, onBusy, onClose, onOpen, open, Panel, registry }: {
  id: string;
  onBusy: (id: string, busy: boolean) => void;
  open: boolean;
  Panel: ComponentType<OverviewPanelContext>;
  onOpen: () => void;
  onClose: () => void;
  registry: PluginRegistry;
}) {
  const reportBusy = useCallback((busy: boolean) => onBusy(id, busy), [id, onBusy]);
  useEffect(() => () => onBusy(id, false), [id, onBusy]);
  return (
    <Card className={`${overviewSurfaceClass} min-h-0 min-w-0 flex-1 gap-0 p-0`}>
      <Panel onBusy={reportBusy} onClose={onClose} onOpen={onOpen} open={open} registry={registry} />
    </Card>
  );
}
