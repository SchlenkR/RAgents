import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type FocusEvent } from "react";
import { useAccess } from "@ragents/web/AccessContext";
import type { SessionHeaderContext, WorkspaceTabContext } from "@ragents/web/PluginRegistry";
import { DetailRow, StopButton } from "@ragents/web/ui";
import { rpc } from "@ragents/web/rpc";
import { useRunPanelHost } from "@ragents/web/run-panel/host";
import { processesContracts, type RunProcess, type RunProcessMachine, type RunProcessPort, type RunProcessSnapshot } from "../contract";
import { messageFrom, portAction, titleOf, type PortAction } from "./processes";

interface ProcessWatchState {
  snapshot: RunProcessSnapshot | undefined;
  error: string | undefined;
}

const idle: ProcessWatchState = { snapshot: undefined, error: undefined };

const portLabelClass = "flex-none rounded-full bg-primary/14 px-2 py-px text-foreground tabular-nums";
const portClass = `${portLabelClass} cursor-pointer underline underline-offset-2 hover:bg-primary/28 focus-visible:bg-primary/28`;
const stopClass = "size-5 min-w-5 rounded-full p-1 [&_svg]:size-2.5";

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
  if (action.kind === "link") return <a aria-label={action.title} className={portClass} href={action.href} rel="noreferrer" target="_blank">:{port.port}</a>;
  if (action.kind === "open") return <button aria-label={action.title} className={portClass} onClick={onOpen} type="button">:{port.port}</button>;
  return <span aria-label={action.title} className={portLabelClass}>:{port.port}</span>;
}

function ProcessRow({ runId, machine, process, state, writable, onStop }: {
  runId: string; machine: RunProcessMachine; process: RunProcess; state?: StopState; writable: boolean; onStop: () => void;
}) {
  const host = useRunPanelHost();
  const open = (port: RunProcessPort) => host.openService({
    runId, port: port.port, workstation: machine === "server" ? null : machine.client, tunnel: processesContracts.tunnel.id,
  });
  const stop = <StopButton busy={state?.busy === true} className={stopClass} disabled={!writable || state?.busy}
    label={state?.busy ? `Stopping ${process.label}` : `Stop ${process.label}`}
    onClick={onStop} size="icon-xs" />;
  const ports = process.ports.map((port) => <PortControl action={portAction(host.kind, machine, window.location.hostname, port)}
    key={`${port.address}:${port.port}`} port={port} onOpen={() => open(port)} />);
  return <div className="flex min-w-0 flex-col gap-1 [overflow-wrap:anywhere]" data-process-id={process.id}>
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="flex min-w-0 flex-[1_1_12rem] items-center gap-2">
        <span className="flex-none"><IconProcess /></span>
        <span className="min-w-0 flex-1" data-slot="process-name">{process.label}</span>
      </span>
      <span className="flex max-w-full flex-wrap items-center gap-1">{ports}{stop}</span>
    </div>
    <p className="whitespace-pre-line text-sm text-muted-foreground">{titleOf(process)}</p>
    {machine !== "server" && process.ports.length > 0 && host.kind === "browser" && <p className="text-sm text-muted-foreground">Open these ports through the RAgents extension in VS Code on workstation {machine.label}.</p>}
    {!writable && <p className="text-sm text-muted-foreground">Stopping requires write and inspection permission.</p>}
    {state?.error && <p className="text-sm text-destructive" role="alert">{state.error}</p>}
  </div>;
}

function ProcessHeaderContent({ runId, panel = false, active = true }: { runId: string; panel?: boolean; active?: boolean }) {
  const access = useAccess();
  const writable = access.can("runs.write") && access.can("runs.inspect");
  const state = useRunProcesses(runId, active);
  const [stops, setStops] = useState<Record<string, StopState>>({});
  const requests = useRef(new Map<string, AbortController>());
  const rootRef = useRef<HTMLDivElement>(null);
  const focused = useRef<HTMLElement>(null);
  const fallback = useRef<HTMLElement>(null);
  const processes = state.snapshot?.processes ?? [];
  useEffect(() => {
    const active = requests.current;
    return () => { for (const controller of active.values()) controller.abort(); active.clear(); };
  }, []);
  useLayoutEffect(() => {
    if (!focused.current || focused.current.isConnected || document.activeElement !== document.body) return;
    const target = rootRef.current?.querySelector<HTMLElement>("button:not(:disabled), a[href]") ?? fallback.current;
    focused.current = null;
    target?.focus({ preventScroll: true });
  }, [state.snapshot]);
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
  const renderProcess = (process: RunProcess) => snapshot
    ? <ProcessRow key={process.id} machine={snapshot.machine} process={process} runId={runId} state={stops[process.id]} writable={writable}
      onStop={() => { void stop(process); }} />
    : null;
  if (panel) return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-2" ref={rootRef} onFocusCapture={rememberFocus}>
    {processes.length > 0 ? processes.map((process) => renderProcess(process)) : <p role="status">No active processes.</p>}
    {state.error !== undefined && <p className="text-destructive" role="alert">{state.error}</p>}
  </div>;
  if (processes.length === 0 && state.error === undefined) return null;
  return <DetailRow explanation="Programs started by this run, with their open ports and stop controls." label="Processes">
    <div aria-label="Processes and ports of the run" className="flex min-w-0 flex-col gap-3" ref={rootRef} onFocusCapture={rememberFocus}>
      {processes.map(renderProcess)}
      {state.error !== undefined && <p className="text-destructive" role="alert">{state.error}</p>}
    </div>
  </DetailRow>;
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
