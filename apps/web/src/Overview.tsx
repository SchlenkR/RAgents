import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui";
import { Modal } from "./ui/modal";
import type { SessionInfo } from "./api";
import type { OverviewPanelContext, OverviewPanelContribution, PluginRegistry } from "./PluginRegistry";
import type { RunReadRevisions } from "./run-read-state";
import { SessionList } from "./SessionList";

/** The run list inside the overview; deletion is the host's job, the section only shows its outcome. */
export interface RunsSectionProps {
  sessions: SessionInfo[];
  seenRevisions?: RunReadRevisions;
  activeId: string | undefined;
  registry: PluginRegistry;
  unreachable: boolean;
  canCreate: boolean;
  canDelete: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onDelete: (ids: readonly string[]) => Promise<void>;
}

interface OverviewProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  registry: PluginRegistry;
  panels: readonly OverviewPanelContribution[];
  onBusy: (id: string, busy: boolean) => void;
  runs?: RunsSectionProps;
}

const FOCUSABLE_SELECTOR =
  "button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

const overviewSurfaceClass = "pointer-events-auto shadow-pop";

/** The corner button opens the run list and contributions placed in the overview. */
export function Overview({ onBusy, onClose, onOpen, open, panels, registry, runs }: OverviewProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const surface = surfaceRef.current;
      if (!surface || surface.contains(document.activeElement)) return;
      surface.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <Modal className="pointer-events-none flex h-[min(900px,100%)] w-[min(1440px,100%)] flex-col rounded-none bg-transparent p-0 ring-0" keepMounted onClose={onClose} open={open} scope="workspace" size="full">
      <DialogTitle className="sr-only">Übersicht</DialogTitle>
      <div className="flex min-h-0 min-w-0 flex-1 gap-4 max-[900px]:flex-col" id="app-overview" ref={surfaceRef}>
      {panels.map(({ id, Panel }) => (
        <OverviewPanelHost id={id} key={id} onBusy={onBusy} onClose={onClose} onOpen={onOpen} open={open} Panel={Panel} registry={registry} />
      ))}
      {runs && <RunsSection {...runs} />}
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

function RunsSection({ activeId, canCreate, canDelete, onCreate, onDelete, onOpen, registry, sessions, seenRevisions, unreachable }: RunsSectionProps) {
  const [error, setError] = useState<string>();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const remove = async (ids: readonly string[]) => {
    setDeleting(true);
    setError(undefined);
    try {
      await onDelete(ids);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeleting(false);
    }
  };

  const removeSelected = async () => {
    await remove(sessions.filter((session) => selectedIds.has(session.id)).map((session) => session.id));
    setConfirmBulkDelete(false);
    exitSelectMode();
  };

  return (
    <section aria-labelledby="overview-runs-title" className="flex min-h-0 min-w-0 flex-1 flex-col max-[900px]:flex-[1_1_50%]">
      <Card className={`${overviewSurfaceClass} min-h-0 flex-1 gap-workspace-inset overflow-y-auto overscroll-contain pt-workspace-inset pr-6 pb-6 pl-6 max-[900px]:px-3 max-[900px]:pt-3.5 max-[900px]:pb-4`}>
        <header className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
          <h2 className="text-[0.95rem] font-semibold" id="overview-runs-title">
            Runs <span className="ml-1 text-[0.8rem] font-medium tabular-nums text-muted-foreground">{sessions.length}</span>
          </h2>
          {unreachable && <span className="text-[0.72rem] font-medium text-destructive" role="alert">Server nicht erreichbar</span>}
          {canDelete && sessions.length > 0 && (
            <div className="ml-auto flex flex-wrap items-center gap-1">
              {selectMode
                ? (
                  <>
                    <Button onClick={() => setSelectedIds(new Set(sessions.map((session) => session.id)))} size="sm" variant="ghost">
                      Alle
                    </Button>
                    <Button onClick={() => setSelectedIds(new Set())} size="sm" variant="ghost">
                      Keine
                    </Button>
                    <Button
                      className="ml-auto"
                      disabled={selectedIds.size === 0 || deleting}
                      onClick={() => setConfirmBulkDelete(true)}
                      size="sm"
                      variant="destructive"
                    >
                      Löschen ({selectedIds.size})
                    </Button>
                    <Button onClick={exitSelectMode} size="sm" variant="ghost">
                      Fertig
                    </Button>
                  </>
                )
                : (
                  <Button onClick={() => setSelectMode(true)} size="sm" variant="ghost">
                    Auswählen
                  </Button>
                )}
            </div>
          )}
        </header>
        {error && <p className="text-[0.72rem] font-medium text-destructive" role="alert">{error}</p>}
        <p className="mb-5.5 text-[0.75rem] text-muted-foreground">Nach letzter Aktivität im Run. Neue Aktivität ist seit Deinem letzten Ansehen hinzugekommen.</p>
        <SessionList
          seenRevisions={seenRevisions}
          activeId={activeId}
          onCreate={canCreate ? onCreate : undefined}
          onDelete={canDelete ? (id) => void remove([id]) : undefined}
          onSelect={onOpen}
          onToggleSelected={toggleSelected}
          registry={registry}
          selectMode={selectMode}
          selectedIds={selectedIds}
          sessions={sessions}
        />
        {confirmBulkDelete && (
          <Dialog open onOpenChange={(open) => { if (!open && !deleting) setConfirmBulkDelete(false); }}>
            <DialogContent scope="page" showCloseButton={false} size="small">
              <DialogHeader>
                <DialogTitle>Runs löschen</DialogTitle>
                <DialogDescription>
                  {selectedIds.size === 1
                    ? "Ein Run wird endgültig gelöscht."
                    : `${selectedIds.size} Runs werden endgültig gelöscht.`}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button disabled={deleting} onClick={() => setConfirmBulkDelete(false)} variant="outline">
                  Abbrechen
                </Button>
                <Button disabled={deleting} onClick={() => void removeSelected()}>
                  {deleting ? "Löscht ..." : `Löschen (${selectedIds.size})`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </Card>
    </section>
  );
}
