import { useCallback, useEffect, useState } from "react";
import { rpc } from "@ragents/web/rpc";
import { RenderBoundary } from "@ragents/web/RenderBoundary";
import { Spinner } from "@ragents/web/ui";
import { globalAppsContracts, type GlobalAppsSnapshot } from "../contract";
import { GlobalAppCard, UnavailableGlobalApp } from "./GlobalAppCard";

export function GlobalAppsContent({ snapshot, onRetry }: { snapshot: GlobalAppsSnapshot; onRetry: () => void }) {
  if (snapshot.apps.length > 0 && snapshot.runId === null) throw new Error("The global apps have no run.");
  return <div className="grid min-w-0 grid-cols-1 gap-6 @min-[960px]/panel:grid-cols-2">
    {snapshot.apps.map((app) => <section aria-label={app.views[0]?.title ?? app.name} className="grid min-w-0 content-start gap-3" key={app.name}>
      <h2 className="type-label">{app.views[0]?.title ?? app.name}</h2>
      <RenderBoundary resetKeys={[app.name, snapshot.revision]} title={`The app ${app.name} could not be displayed`}>
        <GlobalAppCard app={app} runId={snapshot.runId!} revision={snapshot.revision} />
      </RenderBoundary>
    </section>)}
    {snapshot.errors.map((error) => <section aria-label={error.name} className="grid min-w-0 content-start gap-3" key={error.id}>
      <h2 className="type-label">{error.name}</h2>
      <UnavailableGlobalApp name={error.name} problem={error.problem} removable onRetry={onRetry} />
    </section>)}
    {snapshot.problem && <section aria-label="Global apps unavailable" className="grid min-w-0 content-start gap-3">
      <h2 className="type-label">Global apps unavailable</h2>
      <UnavailableGlobalApp name="Global apps" problem={snapshot.problem} removable={false} onRetry={onRetry} />
    </section>}
    {snapshot.apps.length === 0 && snapshot.errors.length === 0 && !snapshot.problem && <p className="type-body text-muted-foreground" role="status">No global apps yet.</p>}
  </div>;
}

export function GlobalAppsPage() {
  const [snapshot, setSnapshot] = useState<GlobalAppsSnapshot>();
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => rpc.subscribe(globalAppsContracts.changed, {}, setSnapshot,
    (problem) => setSnapshot({ runId: null, revision: 0, apps: [], errors: [], problem })), [attempt]);
  return <div className="mx-auto grid w-full max-w-[1280px] min-w-0 gap-4">
    <h1 className="type-title">Apps</h1>
    {snapshot === undefined ? <p className="type-body flex items-center gap-2 text-muted-foreground" role="status"><Spinner />Loading apps ...</p>
      : <GlobalAppsContent snapshot={snapshot} onRetry={retry} />}
  </div>;
}
