import { useEffect, useRef, useState, type PointerEvent } from "react";
import { XIcon } from "lucide-react";
import { cn } from "cn";
import type { SessionContext, SessionNavigation, WorkspaceTabContribution } from "../PluginRegistry";
import { Button } from "../ui";
import { mountedTabs } from "../WorkspacePanel";
import { CHAT_MIN_HEIGHT, clampWorkspaceHeight, RUN_PANEL_WORKSPACE_ID, saveRunPanelWorkspaceState, useRunPanelWorkspaceState } from "./workspace-state";

/** Die Tab-Fläche unter dem Chat des Run-Panels: Griff, Kopfzeile mit Reitername und X, darunter das Panel des Beitrags; besuchte keepMounted-Reiter bleiben montiert. */
export function RunPanelWorkspace({ navigation, onClose, open, runId, session, tabs }: {
  navigation: SessionNavigation;
  onClose: () => void;
  open: boolean;
  runId: string;
  session: SessionContext;
  tabs: readonly WorkspaceTabContribution[];
}) {
  const stored = useRunPanelWorkspaceState(runId);
  const sectionRef = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(stored.height);
  const [visited, setVisited] = useState<readonly string[]>([]);
  const activeTabId = open ? navigation.activeTabId : undefined;
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  useEffect(() => setHeight(stored.height), [stored.height]);
  useEffect(() => {
    if (activeTabId === undefined) return;
    setVisited((current) => current.includes(activeTabId) ? current : [...current, activeTabId]);
  }, [activeTabId]);
  const availableHeight = () => sectionRef.current?.parentElement?.clientHeight ?? Number.POSITIVE_INFINITY;

  return <section
    aria-label="Arbeitsbereich"
    className="flex flex-none flex-col border-t border-border bg-card"
    hidden={!open}
    id={RUN_PANEL_WORKSPACE_ID}
    inert={!open}
    ref={sectionRef}
    style={{ height, maxHeight: `calc(100% - ${CHAT_MIN_HEIGHT}px)` }}
  >
    <Sash
      onChange={(next) => setHeight(clampWorkspaceHeight(next, availableHeight()))}
      onCommit={(next) => saveRunPanelWorkspaceState(runId, { ...stored, height: clampWorkspaceHeight(next, availableHeight()) })}
      value={height}
    />
    <header className="flex h-8 flex-none items-center gap-2 border-b border-border px-2.5">
      <h2 className="min-w-0 flex-1 truncate text-[0.76rem] font-semibold">{activeTab?.label}</h2>
      <Button aria-label="Arbeitsbereich schließen" onClick={onClose} size="icon-xs" title="Arbeitsbereich schließen" variant="ghost"><XIcon /></Button>
    </header>
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {mountedTabs(tabs, activeTabId, visited).map((tab) => <div className={cn("absolute inset-0 flex min-h-0 flex-col", tab.id !== activeTabId && "pointer-events-none invisible")} key={tab.id}>
        <tab.Panel active={tab.id === activeTabId} navigation={navigation} selection={navigation.selectionFor(tab.id)} session={session} />
      </div>)}
    </div>
  </section>;
}

/** Der waagerechte Griff über der Tab-Fläche; ziehen nach oben macht sie höher. */
function Sash({ onChange, onCommit, value }: { onChange: (next: number) => void; onCommit: (next: number) => void; value: number }) {
  const drag = useRef<{ startY: number; startHeight: number }>(undefined);
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = undefined;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onCommit(value);
  };
  return <div
    aria-label="Höhe des Arbeitsbereichs"
    aria-orientation="horizontal"
    aria-valuenow={value}
    className="flex h-2.5 flex-none cursor-row-resize touch-none items-center justify-center border-b border-border bg-shell select-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:-outline-offset-2"
    onKeyDown={(event) => {
      const step = event.key === "ArrowUp" ? 24 : event.key === "ArrowDown" ? -24 : 0;
      if (step === 0) return;
      event.preventDefault();
      onChange(value + step);
      onCommit(value + step);
    }}
    onPointerCancel={finish}
    onPointerDown={(event) => {
      drag.current = { startY: event.clientY, startHeight: value };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => { if (drag.current) onChange(drag.current.startHeight + drag.current.startY - event.clientY); }}
    onPointerUp={finish}
    role="separator"
    tabIndex={0}
  >
    <span aria-hidden className="h-1 w-10 rounded-full bg-border-strong" />
  </div>;
}
