import { useAccess } from "@ragents/web/AccessContext";
import { ArrowLeftIcon, LayoutGridIcon } from "lucide-react";
import { Alert, Badge, Button, cn, Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle, Spinner } from "@ragents/web/ui";
import { ToolbarCopy, ToolbarItem, ToolbarLabel, ToolbarText } from "@ragents/web/Toolbar";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { askPayloadOf, ASK_PLUGIN_ID } from "@ragents/plugins/ragents.ask/ask-payload";
import { answerQuestion } from "@ragents/plugins/ragents.ask/web/api";
import { QuestionCard } from "@ragents/plugins/ragents.ask/web/QuestionCard";
import { ACTOR_PROGRAMS_STATE_ID } from "@ragents/host/plugin-support/actor-programs/contract";
import {
  useSurfaceController,
  type SessionContext,
  type SessionHeaderContext,
  type WorkspaceTabContext,
} from "@ragents/web/PluginRegistry";
import { runViewFrom, type RunAction } from "@ragents/web/run-view";
import { useSurfaceEntities } from "@ragents/plugins/ragents.orchestration/web/surface-entities";
import { SURFACE_TILE_DRAG_TYPE } from "@ragents/plugins/ragents.orchestration/web/tile-docking";
import { ProgramSlotContext, type ProgramSlot } from "@ragents/plugins/ragents.orchestration/web/program-slot";
import {
  type RunApp,
  type RunAppInvocation,
  type ActorProgramsApi,
  type ActorProgramsListing,
  type RunScriptTool,
} from "./api";
import type { JsonValue } from "./bridge";
import { actorProgramSourceView, ProgramSource } from "./ProgramSource";
import { FunctionForm } from "./FunctionForm";
import { ExpandIcon } from "./ExpandIcon";
import { actorProgramsRevision } from "./state-revision";
import { actorProgramViews, currentActorListing } from "./program-state";
import { activeActorInvocations, readActorInvocation } from "./invocations";
import { ActorProgramsContext, useActorPrograms, type ActorProgramsContextValue } from "./context";

export { useActorPrograms, type ActorProgramsContextValue } from "./context";

export const RUN_TOOLS_TAB_ID = "ragents.actor-programs.tools";

const entryIconClass = "flex size-[34px] items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--primary)_12%,var(--background))] text-primary";
const headClass = "grid flex-none grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 border-b border-border-soft px-workspace-inset py-[9px]";
const sectionLabelClass = "mb-2 text-[0.66rem] tracking-[0.075em] text-muted-foreground uppercase";
const quickIconClass = "grid size-[30px] flex-none place-items-center rounded-lg border border-info/25 bg-glass-app text-info";

const ACTIVE_STATUSES = new Set(["queued", "running"]);
const POLL_INTERVAL = 700;

const replaceInvocation = (
  listing: ActorProgramsListing | undefined,
  invocation: RunAppInvocation,
): ActorProgramsListing | undefined => listing && ({
  ...listing,
  apps: listing.apps.map((app) => {
    if (app.actorId !== invocation.actorId || app.revision !== invocation.revision) return app;
    const exists = app.invocations.some((entry) => entry.id === invocation.id);
    return {
      ...app,
      invocations: exists
        ? app.invocations.map((entry) => entry.id === invocation.id ? invocation : entry)
        : [...app.invocations, invocation],
    };
  }),
});

export function ActorProgramsProvider({
  api,
  children,
  session,
}: PropsWithChildren<{ api: ActorProgramsApi; session: SessionContext }>) {
  const runId = session.session.id;
  const canInspect = useAccess().can("runs.inspect");
  const [storedListing, setListing] = useState<ActorProgramsListing>();
  const listing = useMemo(() => currentActorListing(storedListing, session.runView), [storedListing, session.runView]);
  const [error, setError] = useState<string>();
  const [fullscreen, setFullscreen] = useState<{ runId: string; appId: string }>();
  const visibleApps = actorProgramApps(session).filter((app) => app.app.visible !== false);
  const fullscreenAppId = fullscreen?.runId === runId && visibleApps.some((app) => app.id === fullscreen.appId)
    ? fullscreen.appId : undefined;
  const closeFullscreen = useCallback(() => setFullscreen(undefined), []);
  const openFullscreen = useCallback((appId: string) => {
    if (!actorProgramApps(session).some((app) => app.id === appId && app.app.visible !== false)) {
      throw new Error("Die Actor-Ansicht ist nicht auf der Fläche verfügbar.");
    }
    setFullscreen({ runId, appId });
  }, [runId, session]);
  useEffect(() => { if (fullscreen && !fullscreenAppId) setFullscreen(undefined); }, [fullscreen, fullscreenAppId]);
  const loadRevision = useRef(0);

  const refresh = useCallback(async () => {
    const revision = ++loadRevision.current;
    try {
      const next = await api.list(runId);
      if (revision !== loadRevision.current) return;
      setListing(next);
      setError(undefined);
    } catch (caught) {
      if (revision !== loadRevision.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [api, runId]);

  const moduleRevision = useMemo(() => actorProgramsRevision(session.runView), [session.runView]);
  useEffect(() => {
    setListing(undefined);
    setError(undefined);
    return () => { loadRevision.current += 1; };
  }, [runId]);
  useEffect(() => { void refresh(); }, [moduleRevision, refresh]);

  const activeInvocations = useMemo(() => activeActorInvocations(listing?.apps ?? [], canInspect), [canInspect, listing]);
  const activeKey = activeInvocations.length > 0 ? JSON.stringify(activeInvocations) : "";

  useEffect(() => {
    if (!activeKey) return;
    const targets = activeInvocations;
    let disposed = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;

    const poll = async () => {
      controller = new AbortController();
      const results = await Promise.allSettled(targets.map(async (target) => ({
        target,
        invocation: await readActorInvocation(api, runId, target, controller?.signal),
      })));
      if (disposed) return;
      const updates = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      if (updates.length > 0) {
        setListing((current) => updates.reduce((next, update) => replaceInvocation(next, update.invocation), current));
        setError(undefined);
      }
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) setError(failed.reason instanceof Error ? failed.reason.message : String(failed.reason));
      const finished = updates.some((update) => !ACTIVE_STATUSES.has(update.invocation.status));
      if (finished) {
        await refresh();
      } else if (!disposed) {
        timer = window.setTimeout(() => void poll(), POLL_INTERVAL);
      }
    };

    timer = window.setTimeout(() => void poll(), 250);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activeKey encodes activeInvocations; the poll uses the captured targets
  }, [activeKey, api, refresh, runId]);

  const invoke = useCallback(async (
    appId: string,
    revision: string,
    actionId: string,
    requestId: string,
    input: JsonValue,
  ) => {
    loadRevision.current += 1;
    const invocation = await api.invoke(runId, appId, revision, actionId, requestId, input);
    loadRevision.current += 1;
    setListing((current) => replaceInvocation(current, invocation));
    return invocation;
  }, [api, runId]);

  const value = useMemo<ActorProgramsContextValue>(() => ({
    api,
    error,
    fullscreenAppId,
    invoke,
    listing,
    openFullscreen,
    closeFullscreen,
    refresh,
    runId,
  }), [api, error, fullscreenAppId, invoke, listing, openFullscreen, closeFullscreen, refresh, runId]);
  const slot = useMemo<ProgramSlot>(() => ({
    runId,
    needsAnswer: (session, appId) => {
      const app = listing?.apps.find((candidate) => candidate.id === appId);
      return app !== undefined && pendingConfirmationFor(session, app) !== undefined;
    },
    openFullscreen,
    source: (view, actorId) => actorProgramSourceView(api, view, actorId),
  }), [api, listing, openFullscreen, runId]);
  return <ActorProgramsContext.Provider value={value}>
    <ProgramSlotContext.Provider value={slot}>{children}</ProgramSlotContext.Provider>
  </ActorProgramsContext.Provider>;
}

export const actorProgramApps = (session: SessionContext) => actorProgramViews(session.runView);

export const pendingConfirmationFor = (
  session: SessionContext,
  app: Pick<RunApp, "invocations">,
): RunAction | undefined => {
  const view = runViewFrom(session.runView);
  if (!view) return undefined;
  const invocationIds = new Set(app.invocations
    .filter((invocation) => ACTIVE_STATUSES.has(invocation.status))
    .map((invocation) => invocation.id));
  return view.actions.find((action) => action.owner === ASK_PLUGIN_ID
    && action.status === "pending"
    && action.askedBy === view.ownerId
    && action.parameters.source === ACTOR_PROGRAMS_STATE_ID
    && invocationIds.has(action.parameters.invocationId));
};

export function HostConfirmation({ action, session }: { action: RunAction; session: SessionContext }) {
  const access = useAccess();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const answer = async (text: string) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await answerQuestion(session.session.id, action.id, text);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  };

  return (
    <section aria-label="Host-Bestätigung" className="grid flex-none gap-2 border-b border-border-soft bg-warning-soft px-workspace-inset py-2.5" data-slot="host-confirmation">
      <header className="grid gap-0.5">
        <strong className="text-[0.72rem] text-foreground">Bestätigung im Host</strong>
        <span className="text-xs text-muted-foreground">Die App kann diese Entscheidung nicht selbst beantworten.</span>
      </header>
      {busy
        ? <p className="text-xs text-muted-foreground">Antwort wird verarbeitet</p>
        : (
          <QuestionCard
            onAnswer={access.can("runs.write") ? (text: string) => void answer(text) : undefined}
            question={askPayloadOf(action.payload) ?? { question: action.title, options: [], multi: false }}
            text={action.title}
          />
        )}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </section>
  );
}

const targetLabel = (target: RunScriptTool["targets"][number]): string =>
  target.handle ? `@${target.handle}` : target.actorId;

export function ToolsPanel({ active, navigation, selection, session }: WorkspaceTabContext) {
  const { api, error, listing, refresh, runId } = useActorPrograms();
  const selectedName = typeof selection === "string" ? selection : undefined;
  const selected = listing?.tools.find((tool) => tool.name === selectedName);

  if (!listing && !error) {
    return (
      <div className="flex h-full items-center justify-center gap-2.5 text-sm text-muted-foreground">
        <Spinner aria-hidden aria-label={undefined} role={undefined} />
        <span>Funktionen werden geladen</span>
      </div>
    );
  }
  if (!listing) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia><IconTools /></EmptyMedia>
          <EmptyTitle>Funktionen konnten nicht geladen werden</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => void refresh()} variant="outline">Erneut versuchen</Button>
        </EmptyContent>
      </Empty>
    );
  }
  if (selectedName && !selected) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia><IconTools /></EmptyMedia>
          <EmptyTitle>Funktion nicht mehr verfügbar</EmptyTitle>
          <EmptyDescription>Das ausgewählte Actor-Funktion ist in diesem Run nicht mehr installiert.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => navigation.openTab(RUN_TOOLS_TAB_ID, null)} variant="outline">
            Zur Übersicht
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  if (selected) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className={headClass}>
          <Button aria-label="Zurück zur Funktionsübersicht" onClick={() => navigation.openTab(RUN_TOOLS_TAB_ID, null)} size="icon-sm" title="Zurück zur Funktionsübersicht" variant="outline">
            <ArrowLeftIcon />
          </Button>
          <span className="grid min-w-0 gap-px">
            <strong className="truncate text-[0.82rem] font-semibold" title={selected.name}>{selected.name}</strong>
            <small className="truncate text-xs text-muted-foreground">Funktion von @{selected.actorHandle}</small>
          </span>
        </header>
        <div className="flex min-h-0 flex-col gap-[22px] overflow-y-auto px-workspace-inset pt-[18px] pb-7">
          <div className="grid grid-cols-[42px_minmax(0,1fr)] items-start gap-3">
            <span className={cn(entryIconClass, "size-[42px] bg-accent")}><IconTools size={22} /></span>
            <div>
              <h2 className="text-[1.05rem] text-foreground">{selected.name}</h2>
              <p className="mt-1 text-[0.74rem] leading-[1.45] text-muted-foreground">{selected.description}</p>
            </div>
          </div>
          <section>
            <h3 className={sectionLabelClass}>Verfügbar für</h3>
            <div className="flex flex-wrap gap-1.5">
              {selected.targets.map((target) => <span className="rounded-full bg-primary/9 px-2 py-1 text-xs text-foreground" key={target.actorId}>{targetLabel(target)}</span>)}
            </div>
          </section>
          <section>
            <h3 className={sectionLabelClass}>Parameter</h3>
            {active && <FunctionForm detail key={`${runId}:${selected.actorId}:${selected.functionId}:${selected.revision}`} session={session} tool={selected} />}
          </section>
          <ProgramSource api={api} moduleId={selected.moduleId} revision={selected.revision} runId={runId} />
          <dl className="grid grid-cols-2 gap-2">
            {[{ label: "Programm", value: selected.moduleId, title: undefined },
              { label: "Quellhash", value: selected.sourceHash.slice(0, 12), title: selected.sourceHash }].map((fact) => (
              <div className="grid gap-[3px] rounded-lg bg-foreground/4 px-2.5 py-2" key={fact.label}>
                <dt className="text-[0.61rem] text-muted-foreground uppercase">{fact.label}</dt>
                <dd className="truncate font-mono text-xs text-foreground" title={fact.title}>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    );
  }
  if (listing.tools.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia><IconTools /></EmptyMedia>
          <EmptyTitle>Noch keine Funktionen</EmptyTitle>
          <EmptyDescription>Von Agenten erstellte Actor-Funktionen dieses Runs erscheinen hier.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-2 overflow-y-auto px-workspace-inset pt-3 pb-5 [scrollbar-width:thin]">
      {error && <Alert className="mb-1" role="status" variant="destructive">{error}</Alert>}
      {listing.tools.map((tool) => (
        <button
          className="grid w-full cursor-pointer grid-cols-[34px_minmax(0,1fr)_auto_14px] items-center gap-2.5 rounded-lg border border-border bg-card px-[11px] py-2.5 text-left text-foreground transition-[background-color,border-color] hover:border-[color-mix(in_srgb,var(--primary)_52%,var(--border))] hover:bg-[color-mix(in_srgb,var(--primary)_7%,var(--card))] focus-visible:border-[color-mix(in_srgb,var(--primary)_52%,var(--border))] focus-visible:bg-[color-mix(in_srgb,var(--primary)_7%,var(--card))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/52 @max-[470px]:grid-cols-[34px_minmax(0,1fr)_14px]"
          key={tool.name}
          onClick={() => navigation.openTab(RUN_TOOLS_TAB_ID, tool.name)}
          type="button"
        >
          <span className={entryIconClass}><IconTools size={20} /></span>
          <span className="grid min-w-0 gap-0.5">
            <strong className="truncate text-[0.8rem] font-semibold">{tool.name}</strong>
            <small className="truncate text-[0.69rem] text-muted-foreground">{tool.description}</small>
          </span>
          <Badge className="max-w-[132px] truncate @max-[470px]:hidden" variant="secondary">
            {tool.targets.length} {tool.targets.length === 1 ? "Agent" : "Agenten"}
          </Badge>
          <IconOpen />
        </button>
      ))}
    </div>
  );
}

/** Ein Klick auf eine Mini-App wählt ihre Kachel auf der Fläche; die Fläche ist der Flächen-Controller des Orchestrierungs-Plugins. */
export function ActorProgramsHeader({ session }: SessionHeaderContext) {
  const canArrange = useAccess().can("runs.inspect");
  const surface = useSurfaceController();
  const stage = useSurfaceEntities(session.session.id);
  const { closeFullscreen, fullscreenAppId, openFullscreen } = useActorPrograms();
  const apps = actorProgramApps(session).filter((app) => app.app.visible !== false);
  if (apps.length === 0) return null;

  return (
    <nav aria-label="Actor-Ansichten" className="flex min-w-0 flex-none items-stretch">
      {apps.map((app) => (
        <div role="group" aria-label={app.title} key={`app:${app.id}`}
          className={cn("relative flex flex-none items-stretch border-r border-border hover:bg-accent focus-within:bg-accent",
            fullscreenAppId === app.id && "bg-primary/12 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-primary after:content-['']")}>
        <ToolbarItem
          as="button"
          className="max-w-[214px] border-r-0 font-bold hover:not-disabled:bg-transparent"
          draggable={canArrange}
          onDragStart={(event) => {
            if (!canArrange) { event.preventDefault(); return; }
            event.dataTransfer.setData(SURFACE_TILE_DRAG_TYPE, `app:${app.id}`);
            event.dataTransfer.effectAllowed = "move";
            closeFullscreen();
          }}
          onClick={() => {
            if (!surface) throw new Error("Die App-Zugänge brauchen den Flächen-Controller des Orchestrierungs-Plugins.");
            closeFullscreen();
            surface.acceptSelection({ type: "run-app", id: app.id });
          }}
          aria-label={`Mini-App: ${app.title} von @${app.actorHandle}`}
          title={`Mini-App: ${app.title} von @${app.actorHandle}${canArrange ? ". Zum Andocken auf eine Kachel ziehen." : ""}`}
          type="button"
        >
          <span className={cn(quickIconClass, !stage.has(`app:${app.id}`) && "bg-transparent")}><LayoutGridIcon size={20} /></span>
          <ToolbarCopy><ToolbarLabel>@{app.actorHandle}</ToolbarLabel><ToolbarText>{app.title}</ToolbarText></ToolbarCopy>
        </ToolbarItem>
        <ToolbarItem as="button" aria-expanded={fullscreenAppId === app.id} aria-label={`${app.title} ${fullscreenAppId === app.id ? "Vollansicht schließen" : "in Vollansicht öffnen"}`}
          title={`${app.title} ${fullscreenAppId === app.id ? "Vollansicht schließen" : "in Vollansicht öffnen"}`}
          className="relative w-[38px] justify-center border-r-0 p-0 hover:not-disabled:bg-transparent before:pointer-events-none before:absolute before:top-1/4 before:bottom-1/4 before:left-0 before:border-l before:border-dashed before:border-border-strong before:content-['']"
          onClick={() => fullscreenAppId === app.id ? closeFullscreen() : openFullscreen(app.id)} type="button">
          <ExpandIcon />
        </ToolbarItem>
        </div>
      ))}
    </nav>
  );
}

export function ToolsBadge() {
  const { listing } = useActorPrograms();
  return listing && listing.tools.length > 0
    ? <Badge variant="secondary">{listing.tools.length}</Badge>
    : null;
}

function IconTools({ size = 28 }: { size?: number }) {
  return (
    <svg aria-hidden fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24" width={size}>
      <path d="M14.5 6.5 17.5 3.5l3 3-3 3" />
      <path d="m9.5 17.5-3 3-3-3 3-3" />
      <path d="M13 5H9a4 4 0 0 0-4 4v5.5M11 19h4a4 4 0 0 0 4-4V9.5" />
    </svg>
  );
}

function IconOpen() {
  return (
    <svg aria-hidden fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
