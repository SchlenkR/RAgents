import { useEffect, useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";
import { useAccess } from "@ragents/web/AccessContext";
import { RenderBoundary } from "@ragents/web/RenderBoundary";
import { isRecord } from "@ragents/web/lib/guards";
import { rpc } from "@ragents/web/rpc";
import { runViewFrom } from "@ragents/web/run-view";
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, Spinner } from "@ragents/web/ui";
import type { SessionContext, SurfaceElementAdditionContext, SurfaceElementContext, SurfaceElementDefinition } from "@ragents/web/PluginRegistry";
import { APP_DISPLAYS_STATE_ID, appDisplayContracts, appDisplayElementId, type AppDisplayChoice, type AppDisplayGroup, type AppDisplaySnapshot } from "../contract";
import { ActorViewFrame } from "./ActorViewFrame";
import { runAppFrom, type ActorProgramsApi } from "./api";
import { useActorPrograms } from "./context";

const errorText = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
const DISPLAY_ID = /^[a-f0-9]{12}$/;

/** The displays of a run as every viewer sees them: without runs.inspect only their IDs and titles reach the browser. */
export const appDisplaysOf = (runView: unknown): readonly { readonly id: string; readonly title: string }[] => {
  const entry = runViewFrom(runView)?.pluginStates.find((item) => item.pluginId === APP_DISPLAYS_STATE_ID && item.scope.kind === "run");
  if (!entry) return [];
  if (!isRecord(entry.state) || !Array.isArray(entry.state.displays)) throw new Error("The app displays of this run are damaged.");
  return entry.state.displays.map((display) => {
    if (!isRecord(display) || typeof display.id !== "string" || !DISPLAY_ID.test(display.id) || typeof display.title !== "string") throw new Error("An app display of this run is damaged.");
    return { id: display.id, title: display.title };
  });
};

export const appDisplaySurfaceElements = (session: SessionContext): readonly SurfaceElementDefinition[] =>
  appDisplaysOf(session.runView).map(({ id, title }) => ({ id: appDisplayElementId(id), title: `${title} (read-only)`, data: { display: id } }));

function Notice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="m-auto grid max-w-[60ch] justify-items-start gap-3 p-4" role="status">
    <p className="text-sm text-muted-foreground">{message}</p>
    {onRetry && <Button onClick={onRetry} size="sm" variant="outline">Retry</Button>}
  </div>;
}

function DisplayFrame({ api, snapshot }: { api: ActorProgramsApi; snapshot: Extract<AppDisplaySnapshot, { status: "ready" }> }) {
  const app = useMemo(() => runAppFrom(snapshot.app), [snapshot.app]);
  return <ActorViewFrame api={api} app={app} runId={snapshot.runId} />;
}

/** A display's window: a read-only marker that names where the app lives, then the app, or calmly why it cannot be shown. */
export function AppDisplayView({ api, title, snapshot, error, onRetry, onRemove, removal }: {
  api: ActorProgramsApi;
  title: string;
  snapshot: AppDisplaySnapshot | undefined;
  error: string | undefined;
  onRetry: () => void;
  onRemove: (() => void) | undefined;
  removal: { readonly pending: boolean; readonly error?: string };
}) {
  const from = snapshot?.from ?? null;
  const body = error !== undefined ? <Notice message={`The display cannot be loaded: ${error}`} onRetry={onRetry} />
    : snapshot === undefined ? <div className="flex flex-1 items-center justify-center gap-2 text-[0.7rem] text-muted-foreground"><Spinner aria-hidden aria-label={undefined} role={undefined} /><span>Loading app</span></div>
      : snapshot.status === "ready" ? <RenderBoundary resetKeys={[snapshot.runId, snapshot.app.id, snapshot.app.revision]} title="The app could not be displayed"
        fallback={(cause, retry) => <Notice message={cause.message} onRetry={retry} />}><DisplayFrame api={api} snapshot={snapshot} /></RenderBoundary>
        : <Notice message={snapshot.message} onRetry={snapshot.status === "failed" ? onRetry : undefined} />;
  return <article aria-label={title} className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
    <div className="flex flex-none items-center gap-2 border-b border-border-soft px-workspace-inset py-1 text-xs text-muted-foreground" data-slot="app-display-source">
      <Badge tone="neutral">Read-only</Badge>
      <span className="min-w-0 flex-1 whitespace-normal wrap-anywhere" aria-label={from ?? undefined}>{from ? `From ${from}` : "An app from elsewhere"}</span>
      {onRemove && <Button aria-label="Remove display" disabled={removal.pending} onClick={onRemove} size="xs" aria-description="Remove this display from the run" variant="ghost">{removal.pending && <Spinner />}Remove</Button>}
    </div>
    {removal.error && <p className="flex-none px-workspace-inset py-1 text-xs text-destructive" role="alert">{removal.error}</p>}
    {body}
  </article>;
}

const displayOf = (definition: SurfaceElementDefinition): string => {
  if (!isRecord(definition.data) || typeof definition.data.display !== "string") throw new Error("The app display has no identifier.");
  return definition.data.display;
};

export function AppDisplayElement({ definition, session }: SurfaceElementContext) {
  const { api } = useActorPrograms();
  const writable = useAccess().can("runs.write");
  const runId = session.session.id;
  const display = displayOf(definition);
  const [attempt, setAttempt] = useState(0);
  const key = `${runId}:${display}:${attempt}`;
  const [received, setReceived] = useState<{ readonly key: string; readonly snapshot?: AppDisplaySnapshot; readonly error?: string }>();
  const [removal, setRemoval] = useState<{ readonly pending: boolean; readonly error?: string }>({ pending: false });
  useEffect(() => rpc.subscribe(appDisplayContracts.display, { runId, display },
    (snapshot) => setReceived({ key, snapshot }), (error) => setReceived({ key, error })), [display, key, runId]);
  const current = received?.key === key ? received : undefined;
  const remove = () => {
    setRemoval({ pending: true });
    rpc.call(appDisplayContracts.remove, { runId, display }).catch((cause: unknown) => setRemoval({ pending: false, error: errorText(cause) }));
  };
  return <AppDisplayView api={api} error={current?.error} onRemove={writable ? remove : undefined} onRetry={() => setAttempt((value) => value + 1)}
    removal={removal} snapshot={current?.snapshot} title={definition.title ?? display} />;
}

/** The apps to choose from, grouped as the server lists them; a view this run already shows stays visible but cannot be chosen again. */
export function AppDisplayChoices({ groups, pending, onChoose }: { groups: readonly AppDisplayGroup[]; pending: boolean; onChoose: (choice: AppDisplayChoice) => void }) {
  if (groups.length === 0) return <p className="type-body text-muted-foreground">No other app is available to you. Global apps and the apps of your other runs appear here.</p>;
  return <div className="grid gap-4">
    {groups.map((group, index) => <section aria-label={group.label} className="grid gap-2" key={`${index}:${group.label}`}>
      <h3 className="type-meta text-muted-foreground [overflow-wrap:anywhere]">{group.label}</h3>
      <ul className="grid gap-2">
        {group.apps.map((choice) => <li key={`${choice.runId}:${choice.view}`}>
          <button aria-label={choice.shown ? `${choice.title} is shown` : `Show ${choice.title}`} disabled={pending || choice.shown}
            className="group/choice grid w-full gap-1 rounded-xl border border-border bg-card p-3 text-left shadow-card outline-none enabled:hover:border-border-strong enabled:hover:bg-[color-mix(in_srgb,var(--card),var(--foreground)_6%)] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            onClick={() => onChoose(choice)} type="button">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 type-item [overflow-wrap:anywhere]">{choice.title}</span>
              {choice.shown ? <Badge tone="neutral">Shown</Badge> : <PlusIcon aria-hidden className="size-3.5 flex-none text-muted-foreground group-hover/choice:text-primary group-focus-visible/choice:text-primary" />}
            </span>
            {choice.detail !== null && <span className="type-meta text-muted-foreground [overflow-wrap:anywhere]">{choice.detail}</span>}
          </button>
        </li>)}
      </ul>
    </section>)}
  </div>;
}

/** "Show app...": lists what the viewer may display here and pins the chosen view. */
export function AppDisplayPicker({ session, onClose }: SurfaceElementAdditionContext) {
  const runId = session.session.id;
  const [groups, setGroups] = useState<readonly AppDisplayGroup[]>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    rpc.call(appDisplayContracts.sources, { runId }, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setGroups(result.groups);
    }, (cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)); });
    return () => controller.abort();
  }, [attempt, runId]);
  const choose = (choice: AppDisplayChoice) => {
    setPending(true);
    setError(undefined);
    rpc.call(appDisplayContracts.add, { runId, source: { runId: choice.runId, view: choice.view } }).then(({ elementId }) => onClose(elementId), (cause: unknown) => {
      setPending(false);
      setError(errorText(cause));
    });
  };
  return <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open>
    <DialogContent className="gap-3" scope="run" size="medium">
      <DialogHeader>
        <DialogTitle>Show app</DialogTitle>
        <DialogDescription>A read-only window of an app that lives elsewhere. It always shows the app's current state and runs nothing.</DialogDescription>
      </DialogHeader>
      <DialogBody className="grid gap-3">
        {error !== undefined && <div className="grid justify-items-start gap-2"><p className="text-sm text-destructive" role="alert">{error}</p>
          {groups === undefined && <Button onClick={() => { setError(undefined); setAttempt((value) => value + 1); }} size="sm" variant="outline">Retry</Button>}</div>}
        {groups === undefined ? error === undefined && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner />Loading apps...</p>
          : <AppDisplayChoices groups={groups} onChoose={choose} pending={pending} />}
      </DialogBody>
    </DialogContent>
  </Dialog>;
}
