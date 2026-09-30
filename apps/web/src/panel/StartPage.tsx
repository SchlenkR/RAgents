import { ChevronRightIcon, PlusIcon, ServerIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "cn";
import { StartSection, StartTiles, startTileCount } from "../StartTiles";
import { Button, ConnectionStateIcon, connectionStateWord, Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "../ui";
import { busyState, connectionState, routeLabel, stateDetail } from "./connection-state";
import type { ConnectionEntry, ConnectionView } from "./contract";
import type { PanelPageProps } from "./page-props";
import { LoginDialog } from "./PanelDialogs";
import { RunLine, RunList } from "./RunLine";

const RECENT_RUNS = 5;

/** The template behind defaultEntry; the extension names only an id from entries. */
const defaultEntryOf = (connection: ConnectionView): ConnectionEntry | undefined => connection.entries.find((entry) => entry.id === connection.defaultEntry);

const chipPartClass = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/60 enabled:hover:bg-accent";
const iconPartClass = "flex w-8 flex-none items-center justify-center";

/** What the left part of the chip does: the word stands next to the name, the label in the tooltip; without run it is disabled. */
const chipAction = (connection: ConnectionView, send: PanelPageProps["send"], onLogin: (name: string) => void): { word: string; label: string; run?: () => void } => {
  switch (connectionState(connection)) {
    case "login-required":
    case "forbidden": return { word: "Sign in", label: `Sign in to ${connection.name}`, run: () => onLogin(connection.name) };
    case "unreachable":
    case "failed": return { word: "Retry", label: `Retry ${connection.name}`, run: () => send({ action: "retry", name: connection.name }) };
    case "stopped": return connection.kind === "profile"
      ? { word: "Start", label: `Start ${connection.name}`, run: () => send({ action: "startProfile", name: connection.name }) }
      : { word: "Connect", label: `Connect to ${connection.name}`, run: () => send({ action: "connect", name: connection.name }) };
    case "starting": return { word: "starting ...", label: `${connection.name} is starting` };
    case "connected":
    case "ready": return { word: "", label: `Runs on ${connection.name}`, run: () => send({ action: "page", page: "runs", connection: connection.name }) };
  }
};

interface Failure {
  readonly title: string;
  readonly message: string;
}

/** The state icon as a button of its own: on an error it opens the popover with the message, the lock opens the sign-in dialog. */
function StateButton({ connection, action, failure, onFailure, send, onLogin }: {
  connection: ConnectionView;
  action: ReturnType<typeof chipAction>;
  failure: Failure | undefined;
  onFailure: (failure: Failure | undefined) => void;
  send: PanelPageProps["send"];
  onLogin: (name: string) => void;
}) {
  const state = connectionState(connection);
  const detail = stateDetail(connection);
  const missing = connection.missingEnvironment;
  if (state === "login-required") {
    return <button aria-label={`Sign-in for ${connection.name}`} className={cn(iconPartClass, chipPartClass)} onClick={() => onLogin(connection.name)} type="button">
      <ConnectionStateIcon state={state} />
    </button>;
  }
  const shown = detail !== undefined ? { title: connectionStateWord(state), message: detail } : failure;
  return <Popover onOpenChange={(next) => onFailure(next ? shown : undefined)} open={failure !== undefined}>
    <PopoverTrigger aria-label={`Show error of ${connection.name}`} className={cn(iconPartClass, chipPartClass)}>
      <ConnectionStateIcon state={state} />
    </PopoverTrigger>
    {shown && <PopoverContent align="start" className="w-[min(360px,calc(100vw-16px))] gap-2 p-3" collisionPadding={8} dim side="bottom">
      <PopoverHeader><PopoverTitle className="text-[0.8rem] font-semibold text-destructive">{shown.title}</PopoverTitle></PopoverHeader>
      <p className={cn("max-h-[50vh] overflow-auto select-text whitespace-pre-wrap text-[0.72rem] leading-normal [overflow-wrap:anywhere]", shown.message.includes("\n") && "font-mono")}>{shown.message}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => send({ action: "showOutput" })} size="xs" variant="ghost">Open output</Button>
        {missing && <Button aria-label={`Set value for ${missing.variable} and restart ${connection.name}`}
          onClick={() => { onFailure(undefined); send({ action: "setSecret", name: missing.variable, connection: connection.name }); }} size="xs">Set value</Button>}
        {action.run && action.word && <Button onClick={() => { onFailure(undefined); action.run?.(); }} size="xs" variant="secondary">{action.word}</Button>}
      </div>
    </PopoverContent>}
  </Popover>;
}

/** A server as a split button: state, name, action word, and route line on the left, the plus for the default or a new chat on the right. */
function ConnectionChip({ connection, send, onLogin }: {
  connection: ConnectionView;
  send: PanelPageProps["send"];
  onLogin: (name: string) => void;
}) {
  const [failure, setFailure] = useState<Failure>();
  const action = chipAction(connection, send, onLogin);
  const state = connectionState(connection);
  const busy = busyState(connection);
  const detail = stateDetail(connection);
  useEffect(() => { if (!busy && detail === undefined) setFailure(undefined); }, [busy, detail]);
  const canCreate = connection.state.kind === "connected" && connection.canCreate
    && (connection.canCreateFree !== false || defaultEntryOf(connection) !== undefined);
  const route = routeLabel(connection);
  const starter = defaultEntryOf(connection);
  const plusLabel = starter ? `New run from ${starter.title} on ${connection.name}` : `New chat on ${connection.name}`;
  const ownIcon = state === "login-required" || detail !== undefined || failure !== undefined;
  return <li className="flex min-w-0 items-stretch overflow-hidden rounded-md bg-secondary">
    {ownIcon && <StateButton action={action} connection={connection} failure={failure} onFailure={setFailure} onLogin={onLogin} send={send} />}
    <button aria-label={action.label} className={cn("group/action flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-1.5 pl-2 text-left disabled:cursor-default", chipPartClass)}
      disabled={action.run === undefined} onClick={action.run} title={action.label} type="button">
      {!ownIcon && <ConnectionStateIcon state={state} />}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="max-w-[calc(100%-3rem)] flex-none truncate text-[0.76rem] font-semibold">{connection.name}</span>
          {action.word && <span className="ml-auto min-w-0 truncate text-[0.62rem] text-muted-foreground group-enabled/action:group-hover/action:text-foreground">{action.word}</span>}
        </span>
        <span className="truncate font-mono text-[0.62rem] text-muted-foreground" data-cell="route" title={route}>{route}</span>
      </span>
    </button>
    {canCreate
      ? <button aria-label={plusLabel} className={cn("flex w-7 flex-none items-center justify-center border-l border-border-soft text-muted-foreground hover:text-foreground", chipPartClass)}
        onClick={() => send({ action: "newRun", name: connection.name, ...(starter ? { entryId: starter.id } : {}) })} title={plusLabel} type="button"><PlusIcon aria-hidden className="size-3.5" /></button>
      : <span aria-hidden className="w-7 flex-none" />}
  </li>;
}

/** The templates of a server: the default template or New chat first, then the rest; with a heading when there are two or more servers. */
function ConnectionOffers({ connection, marked, send }: { connection: ConnectionView; marked: boolean; send: PanelPageProps["send"] }) {
  return <div className="grid grid-cols-1 gap-1.5">
    {marked && <h3 className="flex items-center gap-1.5 pt-1 text-[0.78rem] font-semibold"><ConnectionStateIcon state={connectionState(connection)} />{connection.name}</h3>}
    <StartTiles defaultEntry={connection.defaultEntry} entries={connection.entries} label={marked ? `Templates on ${connection.name}` : "Templates"}
      onNewChat={connection.canCreateFree === false ? undefined : () => send({ action: "newRun", name: connection.name })} onStart={(entryId) => send({ action: "newRun", name: connection.name, entryId })} />
  </div>;
}

/** The start page: the servers as a block, below them the latest runs and, per reachable server, its templates, the default template or New chat first. */
export function StartPage({ state, send, runDetails }: PanelPageProps) {
  const [login, setLogin] = useState<string>();
  const connections = state.connections;
  const marked = connections.length > 1;
  const runs = connections.flatMap((connection) => connection.runs.map((run) => ({ connection, run })))
    .sort((left, right) => right.run.updatedAt - left.run.updatedAt);
  const reachable = connections.filter((connection) => connection.state.kind === "connected" && connection.canCreate);
  const tiles = reachable.reduce((count, connection) => count + startTileCount(connection.entries, connection.defaultEntry, connection.canCreateFree !== false), 0);
  const loginConnection = connections.find((connection) => connection.name === login);
  return <div className="@container/panel grid grid-cols-1 gap-4">
    {state.problem && <p className="text-[0.8rem] leading-normal text-destructive [overflow-wrap:anywhere]" role="alert">{state.problem}</p>}
    {connections.flatMap((connection) => connection.versionNotice ? [{ name: connection.name, notice: connection.versionNotice }] : []).map(({ name, notice }) =>
      <p className={cn("text-[0.8rem] leading-normal [overflow-wrap:anywhere]", notice.level === "error" ? "text-destructive" : "text-warning")} data-notice={notice.level} key={name}
        role={notice.level === "error" ? "alert" : "status"}>{marked ? `${name}: ${notice.text}` : notice.text}</p>)}
    {connections.length === 0
      ? <div className="grid gap-3">
        <p className="text-[0.85rem] leading-normal text-muted-foreground">No server yet. Add a server by address or a local profile.</p>
        <Button onClick={() => send({ action: "page", page: "connections" })}><ServerIcon data-icon="inline-start" />Add server</Button>
      </div>
      : <>
        <section className="grid grid-cols-1 gap-1.5">
          <StartSection count={connections.length} title="Server" />
          <ul aria-label="Server" className="grid grid-cols-2 gap-1.5 @[560px]/panel:auto-cols-fr @[560px]/panel:grid-flow-col @[560px]/panel:grid-cols-none">
            {connections.map((connection) => <ConnectionChip connection={connection} key={connection.name} onLogin={setLogin} send={send} />)}
          </ul>
        </section>
        <section className="grid grid-cols-1 gap-1.5">
          <StartSection title="Continue">
            {runs.length > 0 && <Button className="text-[0.66rem]" onClick={() => send({ action: "page", page: "runs" })} size="xs" variant="ghost">All {runs.length} runs<ChevronRightIcon data-icon="inline-end" /></Button>}
          </StartSection>
          {runs.length === 0
            ? <p className="text-[0.75rem] text-muted-foreground">No runs yet.</p>
            : <RunList label="Recent" showConnection={marked}>
              {runs.slice(0, RECENT_RUNS).map(({ connection, run }) => <RunLine details={runDetails?.(run.id, connection.name)} connection={connection} key={`${connection.name}:${run.id}`} onOpen={() => send({ action: "openRun", name: connection.name, runId: run.id })} run={run} showConnection={marked} />)}
            </RunList>}
        </section>
        {reachable.length > 0 && <section className="grid grid-cols-1 gap-1.5">
          <StartSection count={tiles} title="New" />
          {reachable.map((connection) => <ConnectionOffers connection={connection} key={connection.name} marked={marked} send={send} />)}
        </section>}
      </>}
    {loginConnection && <LoginDialog connection={loginConnection} onClose={() => setLogin(undefined)} send={send} />}
  </div>;
}
