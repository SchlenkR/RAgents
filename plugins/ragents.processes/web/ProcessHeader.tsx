import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type FocusEvent } from "react";
import { useAccess } from "@aicontainer/web/AccessContext";
import type { SessionHeaderContext } from "@aicontainer/web/PluginRegistry";
import { SquareIcon } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, Spinner, cn } from "@aicontainer/web/ui";
import { ToolbarCopy, ToolbarItem, ToolbarLabel, ToolbarText } from "@aicontainer/web/Toolbar";
import { rpc } from "@aicontainer/web/rpc";
import { processesContracts, type RunProcess, type RunProcessSnapshot } from "../contract";
import { kindLabel, messageFrom, serviceUrl, titleOf, visibleProcesses } from "./processes";

interface ProcessWatchState {
  snapshot: RunProcessSnapshot | undefined;
  error: string | undefined;
}

const idle: ProcessWatchState = { snapshot: undefined, error: undefined };

const pillClass = "inline-flex h-6 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border-soft bg-card/78 pl-2.5 pr-0.5 text-xs font-medium text-muted-foreground data-[origin=background]:border-dashed [&>svg]:flex-none";
const portClass = "flex-none rounded-full bg-primary/14 px-1.5 py-px text-foreground tabular-nums underline underline-offset-2 hover:bg-primary/28 focus-visible:bg-primary/28";
const stopClass = "size-5 min-w-5 rounded-full p-0.75 text-destructive";

const useRunProcesses = (runId: string): ProcessWatchState => {
  const [state, setState] = useState<ProcessWatchState>(idle);
  useEffect(() => {
    setState(idle);
    return rpc.subscribe(processesContracts.live, { runId }, (data) => {
      try {
        const message = messageFrom(data);
        if (message.kind === "snapshot" && message.snapshot.runId !== runId) throw new Error("Der Prozessstand gehört zu einem anderen Lauf");
        setState((current) => message.kind === "snapshot"
          ? { snapshot: message.snapshot, error: undefined }
          : { snapshot: current.snapshot, error: message.error });
      } catch (caught) {
        setState((current) => ({ ...current, error: caught instanceof Error ? caught.message : String(caught) }));
      }
    }, (message) => setState((current) => ({ ...current, error: message })));
  }, [runId]);
  return state;
};

function IconProcess() {
  return <svg aria-hidden fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="12">
    <rect height="16" rx="2" width="18" x="3" y="4" />
    <path d="m7 9 3 3-3 3M13 15h4" />
  </svg>;
}

interface StopState { busy?: boolean; error?: string }

function ProcessPill({ process, state, writable, onStop, toolbar = false }: { process: RunProcess; state?: StopState; writable: boolean; onStop: () => void; toolbar?: boolean }) {
  const stop = <Button className={stopClass} size="icon-xs" variant="ghost"
    aria-label={state?.busy ? `${process.label} wird beendet` : `${process.label} beenden`}
    title={!writable ? "Zum Beenden fehlen Schreib- oder Inspektionsrechte" : state?.busy ? "Wird beendet ..." : `${process.label} beenden`}
    disabled={!writable || state?.busy} aria-busy={state?.busy || undefined} onClick={onStop}>
    {state?.busy ? <Spinner className="size-2.5" /> : <SquareIcon fill="currentColor" size={10} />}
  </Button>;
  const ports = process.ports.map((port) => <a className={portClass} href={serviceUrl(window.location.hostname, port.port)}
    key={`${port.address}:${port.port}`} rel="noreferrer" target="_blank" title={`${port.address}:${port.port} im neuen Tab öffnen`}>
    :{port.port}
  </a>);
  return <div className={cn("flex min-w-0 flex-col", toolbar ? "flex-none self-stretch max-md:not-first:hidden" : "w-full")} data-process-id={process.id}>
    {toolbar
      ? <ToolbarItem className="max-w-none flex-1 data-[origin=background]:[border-right-style:dashed]" data-origin={process.origin} title={titleOf(process)}>
        <IconProcess />
        <ToolbarCopy className="w-35 flex-none">
          <ToolbarLabel>{kindLabel(process)}</ToolbarLabel>
          <ToolbarText>{process.label}</ToolbarText>
        </ToolbarCopy>
        {ports}
        {stop}
      </ToolbarItem>
      : <span className={cn(pillClass, "w-full")} data-origin={process.origin} title={titleOf(process)}>
        <IconProcess />
        <em className="flex-none text-[0.56rem] font-bold uppercase not-italic tracking-[0.035em]">{kindLabel(process)}</em>
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis text-foreground">{process.label}</span>
        {ports}
        {stop}
      </span>}
    {state?.error && <span className={cn("text-[0.65rem] text-destructive", toolbar ? "max-w-62 overflow-hidden text-ellipsis whitespace-nowrap" : "[overflow-wrap:anywhere]")}
      role="alert" title={state.error}>{state.error}</span>}
  </div>;
}

function ProcessHeaderContent({ runId }: { runId: string }) {
  const access = useAccess();
  const writable = access.can("runs.write") && access.can("runs.inspect");
  const state = useRunProcesses(runId);
  const [stops, setStops] = useState<Record<string, StopState>>({});
  const [allOpen, setAllOpen] = useState(false);
  const requests = useRef(new Map<string, AbortController>());
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focused = useRef<HTMLElement>(null);
  const fallback = useRef<HTMLElement>(null);
  const processes = state.snapshot?.processes ?? [];
  const { shown, hidden } = visibleProcesses(processes);
  useEffect(() => {
    const active = requests.current;
    return () => { for (const controller of active.values()) controller.abort(); active.clear(); };
  }, []);
  useLayoutEffect(() => {
    if (!focused.current || focused.current.isConnected || document.activeElement !== document.body) return;
    const target = (allOpen ? dialogRef.current : rootRef.current)?.querySelector<HTMLElement>("button:not(:disabled), a[href]")
      ?? (allOpen ? dialogRef.current : null) ?? fallback.current;
    focused.current = null;
    target?.focus({ preventScroll: true });
  }, [state.snapshot, allOpen]);
  const rememberFocus = (event: FocusEvent<HTMLElement>) => {
    if (!(event.target instanceof HTMLElement)) return;
    focused.current = event.target;
    const header = rootRef.current?.closest("header");
    fallback.current = [...(header?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]") ?? [])]
      .find((element) => !rootRef.current?.contains(element)) ?? null;
  };
  const stop = async (process: RunProcess) => {
    if (!writable || requests.current.has(process.id) || stops[process.id]?.busy) return;
    const controller = new AbortController();
    requests.current.set(process.id, controller);
    setStops((current) => ({ ...current, [process.id]: { busy: true } }));
    try {
      await rpc.call(processesContracts.stop, { runId, processId: process.id }, { signal: controller.signal });
    } catch (cause) {
      if (!controller.signal.aborted) setStops((current) => ({ ...current, [process.id]: { error: cause instanceof Error ? cause.message : String(cause) } }));
    } finally { requests.current.delete(process.id); }
  };
  const renderProcess = (process: RunProcess, toolbar = false) => <ProcessPill key={process.id} process={process} state={stops[process.id]} writable={writable} toolbar={toolbar} onStop={() => { void stop(process); }} />;
  if (shown.length === 0 && state.error === undefined && !allOpen) return null;
  return <>
    <div aria-label="Prozesse und Ports des Laufs" className="flex min-w-0 flex-none items-stretch self-stretch" ref={rootRef} onFocusCapture={rememberFocus}>
      {shown.map((process) => renderProcess(process, true))}
      {(processes.length > 1 || allOpen) && <ToolbarItem as="button" className="md:data-[hidden=false]:hidden" data-hidden={hidden > 0 || allOpen} type="button" onClick={() => setAllOpen(true)} title="Alle Prozesse des Laufs anzeigen">
        <span className="max-md:hidden">{hidden > 0 ? `+${hidden} weitere` : "Prozesse"}</span><span className="hidden max-md:inline">Alle {processes.length}</span>
      </ToolbarItem>}
      {state.error !== undefined && <ToolbarItem className="w-42 text-destructive" role="status" title={state.error}><ToolbarCopy><ToolbarLabel>Prozesse</ToolbarLabel><ToolbarText>Überwachung gestört</ToolbarText></ToolbarCopy></ToolbarItem>}
    </div>
    {allOpen && <Dialog open onOpenChange={(open) => {
      if (open) return;
      setAllOpen(false);
      if (processes.length === 0) requestAnimationFrame(() => fallback.current?.focus({ preventScroll: true }));
    }}>
      <DialogContent scope="run">
        <DialogHeader><DialogTitle>Prozesse und Ports</DialogTitle></DialogHeader>
        <DialogBody className="flex flex-col gap-3 outline-none" ref={dialogRef} tabIndex={-1} onFocusCapture={rememberFocus}>
          {processes.length > 0 ? processes.map((process) => renderProcess(process)) : <p role="status">Keine aktiven Prozesse.</p>}
          {state.error !== undefined && <p className="text-destructive" role="alert">{state.error}</p>}
        </DialogBody>
      </DialogContent>
    </Dialog>}
  </>;
}

export const processHeader = (): ComponentType<SessionHeaderContext> =>
  function ProcessHeader({ session }: SessionHeaderContext) {
    const access = useAccess();
    return access.can("runs.read") && access.can("ragents.processes.read")
      ? <ProcessHeaderContent key={session.session.id} runId={session.session.id} /> : null;
  };
