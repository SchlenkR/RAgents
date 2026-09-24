import { BookIcon, ChevronRightIcon, CodeIcon, PlusIcon, ServerIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "cn";
import { Button, EnvironmentStateIcon, environmentStateWord, Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "../ui";
import type { TargetEntry, TargetView } from "./contract";
import type { PanelPageProps } from "./page-props";
import { LoginDialog } from "./PanelDialogs";
import { RunLine, RunList } from "./RunLine";
import { busyState, environmentState, routeLabel, stateDetail } from "./target-state";

const RECENT_RUNS = 5;
const NEW_CHAT = { category: "Ohne Vorlage", title: "Neuer Chat", description: "Leerer Run, der Auftrag entsteht im Chat." };

const sectionClass = "flex items-baseline gap-2 text-[0.66rem] font-bold uppercase tracking-[0.06em] text-muted-foreground";
const countClass = "font-mono text-[0.62rem] font-normal tracking-normal opacity-80";
const tileClass = "group/tile flex h-full min-w-0 flex-col gap-1.5 rounded-[12px] border border-border-soft bg-card p-2.5 text-left [--tone:var(--primary)]"
  + " hover:border-border hover:bg-accent/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/60";
const entryIcon = (entry: TargetEntry): ReactNode => entry.kind === "skill"
  ? <BookIcon aria-hidden className="size-3.5" />
  : <CodeIcon aria-hidden className="size-3.5" />;
const chatIcon: ReactNode = <PlusIcon aria-hidden className="size-3.5" />;

/** Die Vorlage hinter defaultEntry; die Erweiterung nennt nur eine Kennung aus entries. */
const defaultEntryOf = (target: TargetView): TargetEntry | undefined => target.entries.find((entry) => entry.id === target.defaultEntry);

function Section({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return <div className="flex items-baseline justify-between gap-2">
    <h2 className={sectionClass}>{title}{count !== undefined && <span className={countClass}>{count}</span>}</h2>
    {children}
  </div>;
}

const chipPartClass = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/60 enabled:hover:bg-accent";
const iconPartClass = "flex w-8 flex-none items-center justify-center";

/** Was der linke Teil des Chips tut: das Wort steht neben dem Namen, das Label im Tooltip; ohne run ist er gesperrt. */
const chipAction = (target: TargetView, send: PanelPageProps["send"], onLogin: (name: string) => void): { word: string; label: string; run?: () => void } => {
  switch (environmentState(target)) {
    case "login-required":
    case "forbidden": return { word: "Anmelden", label: `An ${target.name} anmelden`, run: () => onLogin(target.name) };
    case "unreachable":
    case "failed": return { word: "Erneut versuchen", label: `${target.name} erneut versuchen`, run: () => send({ action: "retry", name: target.name }) };
    case "stopped": return target.kind === "profile"
      ? { word: "Starten", label: `${target.name} starten`, run: () => send({ action: "startProfile", name: target.name }) }
      : { word: "Verbinden", label: `Mit ${target.name} verbinden`, run: () => send({ action: "connect", name: target.name }) };
    case "starting": return { word: "startet ...", label: `${target.name} startet` };
    case "connected":
    case "ready": return { word: "", label: `Runs auf ${target.name}`, run: () => send({ action: "page", page: "runs", environment: target.name }) };
  }
};

interface Failure {
  readonly title: string;
  readonly message: string;
}

/** Das Zustandssymbol als eigener Knopf: bei einem Fehler öffnet es das Popover mit der Meldung, das Schloss den Anmeldedialog. */
function StateButton({ target, action, failure, onFailure, send, onLogin }: {
  target: TargetView;
  action: ReturnType<typeof chipAction>;
  failure: Failure | undefined;
  onFailure: (failure: Failure | undefined) => void;
  send: PanelPageProps["send"];
  onLogin: (name: string) => void;
}) {
  const state = environmentState(target);
  const detail = stateDetail(target);
  const missing = target.missingEnvironment;
  if (state === "login-required") {
    return <button aria-label={`Anmeldung an ${target.name}`} className={cn(iconPartClass, chipPartClass)} onClick={() => onLogin(target.name)} type="button">
      <EnvironmentStateIcon state={state} />
    </button>;
  }
  const shown = detail !== undefined ? { title: environmentStateWord(state), message: detail } : failure;
  return <Popover onOpenChange={(next) => onFailure(next ? shown : undefined)} open={failure !== undefined}>
    <PopoverTrigger aria-label={`Fehler von ${target.name} anzeigen`} className={cn(iconPartClass, chipPartClass)}>
      <EnvironmentStateIcon state={state} />
    </PopoverTrigger>
    {shown && <PopoverContent align="start" className="w-[min(360px,calc(100vw-16px))] gap-2 p-3" collisionPadding={8} dim side="bottom" sideOffset={4}>
      <PopoverHeader><PopoverTitle className="text-[0.8rem] font-semibold text-destructive">{shown.title}</PopoverTitle></PopoverHeader>
      <p className={cn("max-h-[50vh] overflow-auto select-text whitespace-pre-wrap text-[0.72rem] leading-normal [overflow-wrap:anywhere]", shown.message.includes("\n") && "font-mono")}>{shown.message}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => send({ action: "showOutput" })} size="xs" variant="ghost">Ausgabe öffnen</Button>
        {missing && <Button aria-label={`Wert für ${missing.variable} setzen und ${target.name} erneut starten`}
          onClick={() => { onFailure(undefined); send({ action: "setSecret", name: missing.variable, environment: target.name }); }} size="xs">Wert setzen</Button>}
        {action.run && action.word && <Button onClick={() => { onFailure(undefined); action.run?.(); }} size="xs" variant="secondary">{action.word}</Button>}
      </div>
    </PopoverContent>}
  </Popover>;
}

/** Eine Umgebung als geteilter Knopf: links Zustand, Name, Aktionswort und Zielzeile, rechts das Plus für den Default oder einen neuen Chat. */
function EnvironmentTile({ target, send, onLogin }: {
  target: TargetView;
  send: PanelPageProps["send"];
  onLogin: (name: string) => void;
}) {
  const [failure, setFailure] = useState<Failure>();
  const action = chipAction(target, send, onLogin);
  const state = environmentState(target);
  const busy = busyState(target);
  const detail = stateDetail(target);
  useEffect(() => { if (!busy && detail === undefined) setFailure(undefined); }, [busy, detail]);
  const canCreate = target.state.kind === "connected" && target.canCreate;
  const route = routeLabel(target);
  const starter = defaultEntryOf(target);
  const plusLabel = starter ? `Neuer Run aus ${starter.title} auf ${target.name}` : `Neuer Chat auf ${target.name}`;
  const ownIcon = state === "login-required" || detail !== undefined || failure !== undefined;
  return <li className="flex min-w-0 items-stretch overflow-hidden rounded-md bg-secondary">
    {ownIcon && <StateButton action={action} failure={failure} onFailure={setFailure} onLogin={onLogin} send={send} target={target} />}
    <button aria-label={action.label} className={cn("group/action flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-1.5 pl-2 text-left disabled:cursor-default", chipPartClass)}
      disabled={action.run === undefined} onClick={action.run} title={action.label} type="button">
      {!ownIcon && <EnvironmentStateIcon state={state} />}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="max-w-[calc(100%-3rem)] flex-none truncate text-[0.76rem] font-semibold">{target.name}</span>
          {action.word && <span className="ml-auto min-w-0 truncate text-[0.62rem] text-muted-foreground group-enabled/action:group-hover/action:text-foreground">{action.word}</span>}
        </span>
        <span className="truncate font-mono text-[0.62rem] text-muted-foreground" data-cell="route" title={route}>{route}</span>
      </span>
    </button>
    {canCreate
      ? <button aria-label={plusLabel} className={cn("flex w-7 flex-none items-center justify-center border-l border-border-soft text-muted-foreground hover:text-foreground", chipPartClass)}
        onClick={() => send({ action: "newRun", name: target.name, ...(starter ? { entryId: starter.id } : {}) })} title={plusLabel} type="button"><PlusIcon aria-hidden className="size-3.5" /></button>
      : <span aria-hidden className="w-7 flex-none" />}
  </li>;
}

function Tile({ category, title, description, icon, standard, guided, onClick }: {
  category: string;
  title: string;
  description: string;
  icon: ReactNode;
  /** Die Kachel ist der Default-Einstieg ihrer Umgebung. */
  standard?: boolean;
  guided?: boolean;
  onClick: () => void;
}) {
  return <li className="min-w-0">
    <button className={tileClass} onClick={onClick} title={title} type="button">
      <span className="flex min-w-0 items-center gap-1.5 text-(--tone)">
        {icon}
        <span className="truncate text-[0.58rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{category}</span>
        {standard && <span className="ml-auto flex-none rounded-sm border border-current px-1 text-[0.52rem] font-semibold uppercase tracking-[0.06em] leading-[1.5] opacity-70">Standard</span>}
      </span>
      <span className="text-[0.76rem] font-semibold leading-snug [overflow-wrap:anywhere]">{title}</span>
      <span className="line-clamp-2 text-[0.66rem] leading-[1.45] text-muted-foreground">{description}</span>
      <span className="mt-auto flex items-center gap-0.5 pt-1.5 text-[0.62rem] font-semibold text-(--tone) opacity-50 group-hover/tile:opacity-100">
        {guided ? "Einrichten" : "Starten"}<ChevronRightIcon aria-hidden className="size-3" />
      </span>
    </button>
  </li>;
}

/** Die Kacheln einer Umgebung: der Einstieg (Standard-Vorlage oder Neuer Chat) zuerst, dann ihre Vorlagen; ab zwei Umgebungen mit Überschrift. */
function EnvironmentOffers({ target, marked, send }: { target: TargetView; marked: boolean; send: PanelPageProps["send"] }) {
  const standard = defaultEntryOf(target);
  const entries = target.entries.filter((entry) => entry.id !== target.defaultEntry);
  return <div className="grid grid-cols-1 gap-1.5">
    {marked && <h3 className="flex items-center gap-1.5 pt-1 text-[0.78rem] font-semibold"><EnvironmentStateIcon state={environmentState(target)} />{target.name}</h3>}
    <ul aria-label={marked ? `Vorlagen auf ${target.name}` : "Vorlagen"} className="grid grid-cols-[repeat(auto-fill,minmax(182px,1fr))] gap-2">
      {standard
        ? <Tile category={standard.category} description={standard.description} guided={standard.guided} icon={entryIcon(standard)} onClick={() => send({ action: "newRun", name: target.name, entryId: standard.id })} standard title={standard.title} />
        : <Tile {...NEW_CHAT} icon={chatIcon} onClick={() => send({ action: "newRun", name: target.name })} />}
      {entries.map((entry) => <Tile category={entry.category} description={entry.description} guided={entry.guided} key={entry.id} icon={entryIcon(entry)}
        onClick={() => send({ action: "newRun", name: target.name, entryId: entry.id })} title={entry.title} />)}
    </ul>
  </div>;
}

/** Die Startseite: die Umgebungen als Block, darunter die letzten Runs und je erreichbarer Umgebung ihr Einstieg vor allen Vorlagen als Kacheln. */
export function StartPage({ state, send }: PanelPageProps) {
  const [login, setLogin] = useState<string>();
  const targets = state.targets;
  const marked = targets.length > 1;
  const runs = targets.flatMap((target) => target.runs.map((run) => ({ target, run })))
    .sort((left, right) => right.run.updatedAt - left.run.updatedAt);
  const reachable = targets.filter((target) => target.state.kind === "connected" && target.canCreate);
  const starters = reachable.map((target) => ({ target, entry: defaultEntryOf(target) }));
  const offers = reachable.flatMap((target) => target.entries.filter((entry) => entry.id !== target.defaultEntry).map((entry) => ({ target, entry })));
  const loginTarget = targets.find((target) => target.name === login);
  return <div className="@container/panel grid grid-cols-1 gap-4">
    {state.problem && <p className="text-[0.8rem] leading-normal text-destructive [overflow-wrap:anywhere]" role="alert">{state.problem}</p>}
    {targets.length === 0
      ? <div className="grid gap-3">
        <p className="text-[0.85rem] leading-normal text-muted-foreground">Noch keine Umgebung. Lege einen Server oder ein lokales Profil an.</p>
        <Button onClick={() => send({ action: "page", page: "environments" })}><ServerIcon data-icon="inline-start" />Umgebung anlegen</Button>
      </div>
      : <>
        <section className="grid grid-cols-1 gap-1.5">
          <Section count={targets.length} title="Umgebungen" />
          <ul aria-label="Umgebungen" className="grid grid-cols-2 gap-1.5 @[560px]/panel:auto-cols-fr @[560px]/panel:grid-flow-col @[560px]/panel:grid-cols-none">
            {targets.map((target) => <EnvironmentTile key={target.name} onLogin={setLogin} send={send} target={target} />)}
          </ul>
        </section>
        <section className="grid grid-cols-1 gap-1.5">
          <Section title="Weiter">
            {runs.length > 0 && <Button className="text-[0.66rem]" onClick={() => send({ action: "page", page: "runs" })} size="xs" variant="ghost">Alle {runs.length} Runs<ChevronRightIcon data-icon="inline-end" /></Button>}
          </Section>
          {runs.length === 0
            ? <p className="text-[0.75rem] text-muted-foreground">Noch keine Runs.</p>
            : <RunList environment={marked} label="Zuletzt">
              {runs.slice(0, RECENT_RUNS).map(({ target, run }) => <RunLine environment={marked} key={`${target.name}:${run.id}`} onOpen={() => send({ action: "openRun", name: target.name, runId: run.id })} run={run} target={target} />)}
            </RunList>}
        </section>
        {starters.length > 0 && <section className="grid grid-cols-1 gap-1.5">
          <Section count={starters.length + offers.length} title="Neu" />
          {reachable.map((target) => <EnvironmentOffers key={target.name} marked={marked} send={send} target={target} />)}
        </section>}
      </>}
    {loginTarget && <LoginDialog onClose={() => setLogin(undefined)} send={send} target={loginTarget} />}
  </div>;
}
