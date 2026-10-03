import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type FocusEvent } from "react";
import { useAccess } from "@ragents/web/AccessContext";
import type { SessionHeaderContext, WorkspaceTabContext } from "@ragents/web/PluginRegistry";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, StopButton, cn } from "@ragents/web/ui";
import { ToolbarCopy, ToolbarItem, ToolbarLabel, ToolbarText } from "@ragents/web/Toolbar";
import { rpc } from "@ragents/web/rpc";
import { useRunPanelHost } from "@ragents/web/run-panel/host";
import { processesContracts, type RunProcess, type RunProcessMachine, type RunProcessPort, type RunProcessSnapshot } from "../contract";
import { kindLabel, messageFrom, portAction, titleOf, visibleProcesses, type PortAction } from "./processes";

interface ProcessWatchState {
  snapshot: RunProcessSnapshot | undefined;
  error: string | undefined;
}

const idle: ProcessWatchState = { snapshot: undefined, error: undefined };

const pillClass = "inline-flex h-6 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border-soft bg-card/78 pl-2.5 pr-0.5 text-xs font-medium text-muted-foreground data-[origin=background]:border-dashed [&>svg]:flex-none";
const portLabelClass = "flex-none rounded-full bg-primary/14 px-1.5 py-px text-foreground tabular-nums";
const portClass = `${portLabelClass} cursor-pointer underline underline-offset-2 hover:bg-primary/28 focus-visible:bg-primary/28`;
const stopClass = "size-5 min-w-5 rounded-full p-0.75 [&_svg]:size-2.5";

const useRunProcesses = (runId: string, active: boolean): ProcessWatchState => {
  const [state, setState] = useState<ProcessWatchState>(idle);
  useEffect(() => {
    if (!active) return;
    setState(idle);
    return rpc.subscribe(processesContracts.live, { runId }, (data) => {
      try {
        const message = messageFrom(data);
        if (message.kind === "snapshot" && message.snapshot.runId !== runId) throw new Error("The process snapshot belongs to another run");
        setState((current) => message.kind === "snapshot"
          ? { snapshot: message.snapshot, error: undefined }
          : { snapshot: current.snapshot, error: message.error });
      } catch (caught) {
        setState((current) => ({ ...current, error: caught instanceof Error ? caught.message : String(caught) }));
      }
    }, (message) => setState((current) => ({ ...current, error: message })));
  }, [active, runId]);
  return state;
};

export function IconProcess() {
  return <svg aria-hidden fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="12">
    <rect height="16" rx="2" width="18" x="3" y="4" />
    <path d="m7 9 3 3-3 3M13 15h4" />
  </svg>;
}

interface StopState { busy?: boolean; error?: string }

function PortControl({ action, port, onOpen }: { action: PortAction; port: RunProcessPort; onOpen: () => void }) {
  if (action.kind === "link") return <a className={portClass} href={action.href} rel="noreferrer" target="_blank" title={action.title}>:{port.port}</a>;
  if (action.kind === "open") return <button className={portClass} onClick={onOpen} title={action.title} type="button">:{port.port}</button>;
  return <span className={portLabelClass} title={action.title}>:{port.port}</span>;
}

function ProcessPill({ runId, machine, process, state, writable, onStop, toolbar = false }: {
  runId: string; machine: RunProcessMachine; process: RunProcess; state?: StopState; writable: boolean; onStop: () => void; toolbar?: boolean;
}) {
  const host = useRunPanelHost();
  const open = (port: RunProcessPort) => host.openService({
    runId, port: port.port, workstation: machine === "server" ? null : machine.client, tunnel: processesContracts.tunnel.id,
  });
  const stop = <StopButton busy={state?.busy === true} className={stopClass} disabled={!writable || state?.busy}
    label={state?.busy ? `Stopping ${process.label}` : `Stop ${process.label}`}
    onClick={onStop} size="icon-xs"
    title={!writable ? "Write or inspect rights are missing to stop" : state?.busy ? "Stopping ..." : `Stop ${process.label}`} />;
  const ports = process.ports.map((port) => <PortControl action={portAction(host.kind, machine, window.location.hostname, port)}
    key={`${port.address}:${port.port}`} port={port} onOpen={() => open(port)} />);
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

function ProcessHeaderContent({ runId, panel = false, active = true }: { runId: string; panel?: boolean; active?: boolean }) {
  const access = useAccess();
  const writable = access.can("runs.write") && access.can("runs.inspect");
  const state = useRunProcesses(runId, active);
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
  const snapshot = state.snapshot;
  const renderProcess = (process: RunProcess, toolbar = false) => snapshot
    ? <ProcessPill key={process.id} machine={snapshot.machine} process={process} runId={runId} state={stops[process.id]} writable={writable}
      toolbar={toolbar} onStop={() => { void stop(process); }} />
    : null;
  if (panel) return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-2" ref={rootRef} onFocusCapture={rememberFocus}>
    {processes.length > 0 ? processes.map((process) => renderProcess(process)) : <p role="status">No active processes.</p>}
    {state.error !== undefined && <p className="text-destructive" role="alert">{state.error}</p>}
  </div>;
  if (shown.length === 0 && state.error === undefined && !allOpen) return null;
  return <>
    <div aria-label="Processes and ports of the run" className="flex min-w-0 flex-none items-stretch self-stretch" ref={rootRef} onFocusCapture={rememberFocus}>
      {shown.map((process) => renderProcess(process, true))}
      {(processes.length > 1 || allOpen) && <ToolbarItem as="button" className="md:data-[hidden=false]:hidden" data-hidden={hidden > 0 || allOpen} type="button" onClick={() => setAllOpen(true)} title="Show all processes of the run">
        <span className="max-md:hidden">{hidden > 0 ? `+${hidden} more` : "Processes"}</span><span className="hidden max-md:inline">All {processes.length}</span>
      </ToolbarItem>}
      {state.error !== undefined && <ToolbarItem className="w-42 text-destructive" role="status" title={state.error}><ToolbarCopy><ToolbarLabel>Processes</ToolbarLabel><ToolbarText>Monitoring disrupted</ToolbarText></ToolbarCopy></ToolbarItem>}
    </div>
    {allOpen && <Dialog open onOpenChange={(open) => {
      if (open) return;
      setAllOpen(false);
      if (processes.length === 0) requestAnimationFrame(() => fallback.current?.focus({ preventScroll: true }));
    }}>
      <DialogContent scope="run">
        <DialogHeader><DialogTitle>Processes and ports</DialogTitle></DialogHeader>
        <DialogBody className="flex flex-col gap-3 outline-none" ref={dialogRef} tabIndex={-1} onFocusCapture={rememberFocus}>
          {processes.length > 0 ? processes.map((process) => renderProcess(process)) : <p role="status">No active processes.</p>}
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

export function ProcessesPanel({ active, session }: WorkspaceTabContext) {
  return <ProcessHeaderContent active={active} panel runId={session.session.id} />;
}
