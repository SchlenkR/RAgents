import { useCallback, useEffect, useState } from "react";
import { useAccess } from "@ragents/web/AccessContext";
import { RenderBoundary } from "@ragents/web/RenderBoundary";
import { Badge, Button, Card, CardContent, ChoiceSelect, Spinner } from "@ragents/web/ui";
import { rpc } from "@ragents/web/rpc";
import { ActorViewFrame } from "@ragents/plugins/ragents.actor-programs/web/ActorViewFrame";
import { createActorProgramsApi, type RunApp } from "@ragents/plugins/ragents.actor-programs/web/api";
import { actorProgramContracts } from "@ragents/host/plugin-support/actor-programs/contract";
import { globalAppsContracts, type GlobalAppSummary } from "../contract";
import { GlobalAppDetails } from "./GlobalAppDetails";

const api = createActorProgramsApi("/api/plugins/ragents.actor-programs");
const errorText = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
const time = (at: string | null): string => at === null ? "None" : new Date(at).toLocaleString();

export function GlobalAppError({ problem, onRetry, details }: { problem: string; onRetry: () => void; details: { label: string; act: () => void } | null }) {
  return <div className="grid min-w-0 gap-3">
    <p role="alert" className="break-words text-base text-destructive">{problem}</p>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>{details && <Button size="sm" variant="ghost" onClick={details.act}>{details.label}</Button>}</div>
  </div>;
}

function GlobalView({ actorId, runId, view, revision, onFailure }: { actorId: string; runId: string; view: GlobalAppSummary["views"][number]; revision: number; onFailure: (cause: string) => void }) {
  const [app, setApp] = useState<RunApp>();
  useEffect(() => {
    const controller = new AbortController();
    void api.list(runId, controller.signal, actorId).then((value) => {
      const loaded = value.apps.find((app) => app.id === view.id);
      if (!loaded) throw new Error("The app view is unavailable.");
      if (!controller.signal.aborted) setApp(loaded);
    }).catch((cause) => { if (!controller.signal.aborted) onFailure(errorText(cause)); });
    return () => controller.abort();
  }, [actorId, runId, view.id, view.revision, revision, onFailure]);
  const invoke = useCallback(async (appId: string, appRevision: string, actionId: string, requestId: string, input: Parameters<typeof api.invoke>[5]) => {
    const started = await api.invoke(runId, appId, appRevision, actionId, requestId, input);
    return started;
  }, [runId]);
  if (!app) return <p role="status" className="flex items-center gap-2 text-base text-muted-foreground"><Spinner />Loading app...</p>;
  return <div className="flex h-80 min-w-0 flex-col @min-[48rem]/global-app:h-96"><ActorViewFrame api={api} app={app} invoke={invoke} runId={runId} onFailure={onFailure} /></div>;
}

export function GlobalAppCard({ app, runId, revision }: { app: GlobalAppSummary; runId: string; revision: number }) {
  const access = useAccess();
  const writable = access.can("ragents.global-apps.write") && access.can("runs.write");
  const [details, setDetails] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [generation, setGeneration] = useState(0);
  const [selected, setSelected] = useState(app.views[0]?.id);
  const openDetails = () => setDetails(true);
  const failed = useCallback((cause: string) => setError(cause), []);
  const retry = () => { setError(undefined); setGeneration((value) => value + 1); };
  const act = async (work: () => Promise<unknown>) => {
    setPending(true);
    try { await work(); retry(); } catch (cause) { setError(errorText(cause)); } finally { setPending(false); }
  };
  const view = app.views.find((entry) => entry.id === selected) ?? app.views[0];
  const failedRun = app.lastResult !== null && app.lastResult.outcome !== "completed" && !["running", "queued"].includes(app.status);
  const problem = error ?? app.problem ?? (failedRun ? app.lastResult!.summary : undefined);
  const program = { runId, actorId: app.actorId };
  const opened = { label: "Open details", act: openDetails };
  return <div className="@container/global-app min-w-0">
    <Card><CardContent className="grid min-w-0 gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Badge tone={app.status === "blocked" ? "danger" : app.status === "running" ? "info" : "neutral"}>{app.status}</Badge>
        <Button size="xs" variant="ghost" onClick={openDetails}>Open details</Button>
      </div>
      <p className="break-words text-base text-muted-foreground">{app.description}</p>
      {problem ? <GlobalAppError problem={problem} details={opened} onRetry={() => {
        if (app.problem && writable && app.input) void act(() => rpc.call(actorProgramContracts.pause, { ...program, paused: app.paused }));
        else if (failedRun && writable && app.input) void act(() => rpc.call(actorProgramContracts.trigger, program));
        else retry();
      }} /> : view ? <RenderBoundary resetKeys={[generation, view.id, view.revision]} title="The global app could not be rendered"
        fallback={(cause, reset) => <GlobalAppError problem={cause.message} details={opened} onRetry={() => { reset(); retry(); }} />}>
        {app.views.length > 1 && <ChoiceSelect label="View" value={view.id} onValueChange={setSelected} options={app.views.map((entry) => ({ value: entry.id, label: entry.title }))} />}
        <GlobalView key={`${view.id}:${generation}`} actorId={app.actorId} runId={runId} view={view} revision={revision} onFailure={failed} />
      </RenderBoundary> : null}
      <dl className="grid gap-1 text-sm text-muted-foreground"><div><dt>Last run</dt><dd>{time(app.lastRunAt)}</dd></div><div><dt>Next run</dt><dd>{time(app.nextRunAt)}</dd></div><div><dt>Last result</dt><dd className="break-words">{app.lastResult ? `${app.lastResult.outcome}: ${app.lastResult.summary}` : "No runs yet."}</dd></div></dl>
      {writable && app.input && <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending || ["running", "queued", "blocked"].includes(app.status)} onClick={() => { void act(() => rpc.call(actorProgramContracts.trigger, program)); }}>{pending && <Spinner />}Run now</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => { void act(() => rpc.call(actorProgramContracts.pause, { ...program, paused: !app.paused })); }}>{app.paused ? "Resume" : "Pause"}</Button>
      </div>}
    </CardContent></Card>
    {details && <GlobalAppDetails app={app} runId={runId} revision={revision} writable={writable} onClose={() => setDetails(false)} />}
  </div>;
}

/** An app without an active program offers removal instead of details. */
export function UnavailableGlobalApp({ name, problem, removable, onRetry }: { name: string; problem: string; removable: boolean; onRetry: () => void }) {
  const access = useAccess();
  const writable = access.can("ragents.global-apps.write") && access.can("runs.write");
  const [error, setError] = useState<string>();
  const remove = () => { void rpc.call(globalAppsContracts.remove, { name }).then(onRetry, (cause) => setError(errorText(cause))); };
  return <Card><CardContent><GlobalAppError problem={error ?? problem} onRetry={onRetry} details={writable && removable ? { label: "Remove", act: remove } : null} /></CardContent></Card>;
}
