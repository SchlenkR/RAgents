import { useEffect, useState, type ReactNode } from "react";
import { SourceCode } from "@ragents/web/SourceCode";
import { Alert, Button, cn, Spinner } from "@ragents/web/ui";
import type { RunView } from "@ragents/web/run-view";
import type { ActorProgramSourceFile, ActorProgramsApi } from "./api";
import { actorProgramSourceReference } from "./program-state";

type SourceState =
  | { kind: "loading" }
  | { kind: "ready"; files: ActorProgramSourceFile[] }
  | { kind: "error"; message: string };

export function ProgramSource({ api, moduleId, runId, revision, expandedByDefault = false }: {
  api: ActorProgramsApi;
  moduleId: string;
  runId: string;
  revision?: string;
  expandedByDefault?: boolean;
}) {
  const [expanded, setExpanded] = useState(expandedByDefault);
  const [state, setState] = useState<SourceState>({ kind: "loading" });
  const [activePath, setActivePath] = useState<string>();

  useEffect(() => {
    if (!expanded) return undefined;
    const controller = new AbortController();
    setState({ kind: "loading" });
    api.source(runId, moduleId, controller.signal).then(
      (files) => {
        if (controller.signal.aborted) return;
        setState({ kind: "ready", files });
        setActivePath(files.find((file) => file.path === "src/server.ts")?.path ?? files.find((file) => /\.tsx?$/.test(file.path))?.path ?? files[0]?.path);
      },
      (caught: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: caught instanceof Error ? caught.message : String(caught) });
      },
    );
    return () => controller.abort();
  }, [api, expanded, moduleId, runId, revision]);

  const active = state.kind === "ready"
    ? state.files.find((file) => file.path === activePath) ?? state.files[0]
    : undefined;

  return (
    <section className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] justify-items-start gap-2">
      <h3 className="text-xs font-semibold text-muted-foreground">Quellcode</h3>
      {!expanded && (
        <Button onClick={() => setExpanded(true)} size="sm" variant="outline">Quellcode anzeigen</Button>
      )}
      {expanded && (
        <>
          <p className="text-[0.67rem] text-muted-foreground">Quelle des installierten Builds</p>
          {state.kind === "loading" && (
            <p className="flex items-center gap-2 text-[0.72rem] text-muted-foreground">
              <Spinner aria-hidden aria-label={undefined} role={undefined} />
              <span>Quellcode wird geladen</span>
            </p>
          )}
          {state.kind === "error" && <Alert className="w-full" variant="destructive">{state.message}</Alert>}
          {state.kind === "ready" && (
            <div className="flex flex-wrap gap-1.5">
              {state.files.map((file) => (
                <button
                  className={cn("max-w-full cursor-pointer rounded-lg border border-border-soft bg-background/70 px-[9px] py-1 text-left font-mono text-[0.66rem] text-muted-foreground [overflow-wrap:anywhere]",
                    file.path === active?.path && "border-[color-mix(in_srgb,var(--primary)_48%,var(--border))] bg-primary/9 text-foreground")}
                  key={file.path}
                  onClick={() => setActivePath(file.path)}
                  type="button"
                >
                  {file.path}
                </button>
              ))}
            </div>
          )}
          {active && <SourceCode className="h-full max-h-[340px] w-full min-h-0 min-w-0 overflow-auto rounded-lg border border-border-soft bg-background/70" content={active.content} path={active.path} />}
          {!expandedByDefault && <Button onClick={() => setExpanded(false)} size="sm" variant="outline">Quellcode ausblenden</Button>}
        </>
      )}
    </section>
  );
}

/** The installed source of the actor's program, or nothing if the actor runs none. */
export const actorProgramSourceView = (api: ActorProgramsApi, view: RunView, actorId: string): ReactNode => {
  const program = actorProgramSourceReference(view, actorId);
  return program && <ProgramSource api={api} expandedByDefault key={`${view.id}:${actorId}:${program.revision}`}
    moduleId={program.name} revision={program.revision} runId={view.id} />;
};
