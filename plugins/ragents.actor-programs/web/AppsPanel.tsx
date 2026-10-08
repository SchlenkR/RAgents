import { useAccess } from "@ragents/web/AccessContext";
import { ArrowLeftIcon } from "lucide-react";
import { Alert, Badge, Button, cn, Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle, Spinner } from "@ragents/web/ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { askPayloadOf, ASK_PLUGIN_ID, type QuestionAnswer } from "@ragents/plugins/ragents.ask/ask-payload";
import { answerQuestions } from "@ragents/plugins/ragents.ask/web/api";
import { QuestionCard } from "@ragents/plugins/ragents.ask/web/QuestionCard";
import { ACTOR_PROGRAMS_STATE_ID } from "@ragents/host/plugin-support/actor-programs/contract";
import {
  type SessionContext,
  type WorkspaceTabContext,
} from "@ragents/web/PluginRegistry";
import { runViewFrom, type RunAction } from "@ragents/web/run-view";
import { ProgramSlotContext, type ProgramSlot } from "@ragents/plugins/ragents.orchestration/web/program-slot";
import {
  toolKeyOf,
  type RunApp,
  type RunAppInvocation,
  type ActorProgramsApi,
  type ActorProgramsListing,
  type RunScriptTool,
} from "./api";
import type { JsonValue } from "./bridge";
import { actorProgramSourceView, ProgramSource } from "./ProgramSource";
import { FunctionForm } from "./FunctionForm";
import { actorProgramsRevision } from "./state-revision";
import { actorProgramViews, currentActorListing } from "./program-state";
import { activeActorInvocations, readActorInvocation } from "./invocations";
import { ActorProgramsContext, useActorPrograms, type ActorProgramsContextValue } from "./context";

export { useActorPrograms, type ActorProgramsContextValue } from "./context";

export const RUN_TOOLS_TAB_ID = "ragents.actor-programs.tools";

const entryIconClass = "flex size-[34px] items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--primary)_12%,var(--background))] text-primary";
const headClass = "grid flex-none grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b border-border-soft px-workspace-inset py-2";
const sectionLabelClass = "mb-2 text-[0.66rem] tracking-[0.075em] text-muted-foreground uppercase";

const ACTIVE_STATUSES = new Set(["queued", "running"]);
const POLL_INTERVAL = 700;
const LIST_RETRY_DELAYS = [500, 1500, 4000];

interface ListingScope {
  readonly api: ActorProgramsApi;
  readonly runId: string;
  disposed: boolean;
  revision: number;
  timer?: number;
  controller?: AbortController;
}

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
  const scope = useMemo<ListingScope>(() => ({ api, runId, disposed: false, revision: 0 }), [api, runId]);
  const [loaded, setLoaded] = useState<{ scope: ListingScope; listing?: ActorProgramsListing; error?: string }>();
  const storedListing = loaded?.scope === scope ? loaded.listing : undefined;
  const listing = useMemo(() => currentActorListing(storedListing, session.runView), [storedListing, session.runView]);
  const error = loaded?.scope === scope ? loaded.error : undefined;

  const refresh = useCallback(async () => {
    let attempt = 0;
    const load = async () => {
      if (scope.disposed) return;
      window.clearTimeout(scope.timer);
      scope.controller?.abort();
      const controller = new AbortController();
      scope.controller = controller;
      const revision = ++scope.revision;
      try {
        const next = await scope.api.list(scope.runId, controller.signal);
        if (scope.disposed || revision !== scope.revision) return;
        setLoaded({ scope, listing: next });
      } catch (caught) {
        if (scope.disposed || revision !== scope.revision) return;
        setLoaded((current) => ({ scope, listing: current?.scope === scope ? current.listing : undefined,
          error: caught instanceof Error ? caught.message : String(caught) }));
        const delay = LIST_RETRY_DELAYS[attempt++];
        if (delay !== undefined) scope.timer = window.setTimeout(() => void load(), delay);
      }
    };
    await load();
  }, [scope]);

  const moduleRevision = useMemo(() => actorProgramsRevision(session.runView), [session.runView]);
  useEffect(() => {
    scope.disposed = false;
    window.addEventListener("online", refresh);
    return () => {
      scope.disposed = true;
      scope.revision += 1;
      scope.controller?.abort();
      window.clearTimeout(scope.timer);
      window.removeEventListener("online", refresh);
    };
  }, [refresh, scope]);
  useEffect(() => { void refresh(); }, [moduleRevision, refresh, session.connected]);

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
        setLoaded((current) => ({ scope, listing: updates.reduce((next, update) => replaceInvocation(next, update.invocation), current?.scope === scope ? current.listing : undefined) }));
      }
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) setLoaded((current) => ({ scope, listing: current?.scope === scope ? current.listing : undefined,
        error: failed.reason instanceof Error ? failed.reason.message : String(failed.reason) }));
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
  }, [activeKey, api, refresh, runId, scope]);

  const invoke = useCallback(async (
    appId: string,
    revision: string,
    actionId: string,
    requestId: string,
    input: JsonValue,
  ) => {
    if (scope.disposed) throw new Error("The actor program provider is no longer active.");
    scope.revision += 1;
    try {
      const invocation = await api.invoke(runId, appId, revision, actionId, requestId, input);
      if (scope.disposed) return invocation;
      scope.revision += 1;
      setLoaded((current) => ({ scope, listing: replaceInvocation(current?.scope === scope ? current.listing : undefined, invocation),
        error: current?.scope === scope ? current.error : undefined }));
      return invocation;
    } finally {
      if (!scope.disposed) void refresh();
    }
  }, [api, refresh, runId, scope]);

  const value = useMemo<ActorProgramsContextValue>(() => ({
    api,
    error,
    invoke,
    listing,
    refresh,
    runId,
  }), [api, error, invoke, listing, refresh, runId]);
  const slot = useMemo<ProgramSlot>(() => ({
    runId,
    source: (view, actorId) => actorProgramSourceView(api, view, actorId),
  }), [api, runId]);
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

  const answer = async (answers: readonly QuestionAnswer[]) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await answerQuestions(session.session.id, action.id, answers);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  };

  return (
    <section aria-label="Host confirmation" className="grid flex-none gap-2 border-b border-border-soft bg-warning-soft px-workspace-inset py-3" data-slot="host-confirmation">
      <header className="grid gap-0.5">
        <strong className="text-[0.72rem] text-foreground">Confirmation in the host</strong>
        <span className="text-xs text-muted-foreground">The app cannot answer this decision itself.</span>
      </header>
      {busy
        ? <p className="text-xs text-muted-foreground">Processing answer</p>
        : (
          <QuestionCard
            onAnswer={access.can("runs.write") ? (answers) => void answer(answers) : undefined}
            questions={askPayloadOf(action.payload).questions}
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
  const selectedKey = typeof selection === "string" ? selection : undefined;
  const selected = listing?.tools.find((tool) => toolKeyOf(tool) === selectedKey);

  if (!listing && !error) {
    return (
      <div className="flex h-full items-center justify-center gap-3 text-sm text-muted-foreground">
        <Spinner aria-hidden aria-label={undefined} role={undefined} />
        <span>Loading functions</span>
      </div>
    );
  }
  if (!listing) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia><IconTools /></EmptyMedia>
          <EmptyTitle>Functions could not be loaded</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => void refresh()} variant="outline">Retry</Button>
        </EmptyContent>
      </Empty>
    );
  }
  if (selectedKey && !selected) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia><IconTools /></EmptyMedia>
          <EmptyTitle>Function no longer available</EmptyTitle>
          <EmptyDescription>The selected actor function is no longer installed in this run.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => navigation.openTab(RUN_TOOLS_TAB_ID, null)} variant="outline">
            To overview
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  if (selected) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className={headClass}>
          <Button aria-label="Back to function overview" onClick={() => navigation.openTab(RUN_TOOLS_TAB_ID, null)} size="icon-sm" title="Back to function overview" variant="outline">
            <ArrowLeftIcon />
          </Button>
          <span className="grid min-w-0 gap-px">
            <strong className="truncate text-[0.82rem] font-semibold" title={selected.name}>{selected.name}</strong>
            <small className="truncate text-xs text-muted-foreground">Function of @{selected.actorHandle}</small>
          </span>
        </header>
        <div className="flex min-h-0 flex-col gap-6 overflow-y-auto px-workspace-inset pt-4 pb-6">
          <div className="grid grid-cols-[42px_minmax(0,1fr)] items-start gap-3">
            <span className={cn(entryIconClass, "size-[42px] bg-accent")}><IconTools size={22} /></span>
            <div>
              <h2 className="text-[1.05rem] text-foreground">{selected.name}</h2>
              <p className="mt-1 text-[0.74rem] leading-[1.45] text-muted-foreground">{selected.description}</p>
            </div>
          </div>
          <section>
            <h3 className={sectionLabelClass}>Available to</h3>
            <div className="flex flex-wrap gap-2">
              {selected.targets.map((target) => <span className="rounded-full bg-primary/9 px-2 py-1 text-xs text-foreground" key={target.actorId}>{targetLabel(target)}</span>)}
            </div>
          </section>
          <section>
            <h3 className={sectionLabelClass}>Parameter</h3>
            {active && <FunctionForm detail key={`${runId}:${selected.actorId}:${selected.functionId}:${selected.revision}`} session={session} tool={selected} />}
          </section>
          <ProgramSource api={api} moduleId={selected.moduleId} revision={selected.revision} runId={runId} />
          <dl className="grid grid-cols-2 gap-2">
            {[{ label: "Program", value: selected.moduleId, title: undefined },
              { label: "Source hash", value: selected.sourceHash.slice(0, 12), title: selected.sourceHash }].map((fact) => (
              <div className="grid gap-1 rounded-lg bg-foreground/4 px-3 py-2" key={fact.label}>
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
          <EmptyTitle>No functions yet</EmptyTitle>
          <EmptyDescription>Actor functions created by agents in this run appear here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-2 overflow-y-auto px-workspace-inset pt-3 pb-4 [scrollbar-width:thin]">
      {error && <Alert className="mb-1" role="status" variant="destructive">{error}</Alert>}
      {listing.tools.map((tool) => (
        <button
          className="grid w-full cursor-pointer grid-cols-[34px_minmax(0,1fr)_auto_14px] items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left text-foreground transition-[background-color,border-color] hover:border-[color-mix(in_srgb,var(--primary)_52%,var(--border))] hover:bg-[color-mix(in_srgb,var(--primary)_7%,var(--card))] focus-visible:border-[color-mix(in_srgb,var(--primary)_52%,var(--border))] focus-visible:bg-[color-mix(in_srgb,var(--primary)_7%,var(--card))] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring @max-[470px]:grid-cols-[34px_minmax(0,1fr)_14px]"
          key={toolKeyOf(tool)}
          onClick={() => navigation.openTab(RUN_TOOLS_TAB_ID, toolKeyOf(tool))}
          type="button"
        >
          <span className={entryIconClass}><IconTools size={20} /></span>
          <span className="grid min-w-0 gap-0.5">
            <strong className="truncate text-[0.8rem] font-semibold">{tool.name}</strong>
            <small className="truncate text-[0.69rem] text-muted-foreground">{tool.description}</small>
          </span>
          <Badge className="max-w-[132px] truncate @max-[470px]:hidden" variant="secondary">
            {tool.targets.length} {tool.targets.length === 1 ? "agent" : "agents"}
          </Badge>
          <IconOpen />
        </button>
      ))}
    </div>
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
