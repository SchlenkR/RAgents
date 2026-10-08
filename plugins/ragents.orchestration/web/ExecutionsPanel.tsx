import { useEffect, useMemo, useState } from "react";
import type { JournalEvent } from "@ragents/engine/src/domain/events";
import type { WorkspaceTabContext } from "@ragents/web/PluginRegistry";
import { SourceCode } from "@ragents/web/SourceCode";
import { Alert, AlertDescription, Badge, Button, FilterSelect, SearchInput, type BadgeTone } from "@ragents/web/ui";
import { runContracts } from "@ragents/engine/src/http/contracts";
import { rpc } from "@ragents/web/rpc";
import { executionDuration, executionEventsFrom, executionStatusLabel, filterExecutions, projectExecutions, type ExecutionStatus, type TypeScriptExecution } from "./executions";
import { runViewFrom, type RunView } from "@ragents/web/run-view";

export const EXECUTIONS_TAB_ID = "ragents.orchestration.executions";

export function ExecutionsPanel({ active, session }: WorkspaceTabContext) {
  const view = runViewFrom(session.runView);
  const runId = session.session.id;
  return <RunExecutionsPanel active={active} key={runId} runId={runId} view={view?.id === runId ? view : undefined} />;
}

function RunExecutionsPanel({ active, runId, view }: { active: boolean; runId: string; view: RunView | undefined }) {
  const [journal, setJournal] = useState<{ events: readonly JournalEvent[]; loaded: boolean; loading: boolean; error: string | null }>({ events: [], loaded: false, loading: false, error: null });
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const statusOptions = (["running", "completed", "failed", "interrupted"] as const).map((value) => ({ value, label: executionStatusLabel(value) }));
  const [now, setNow] = useState(Date.now);
  const [reload, setReload] = useState(0);
  const revision = view?.revision;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setJournal((previous) => ({ ...previous, loading: true, error: null }));
    void rpc.call(runContracts.events, { runId }, { signal: controller.signal })
      .then((result) => {
        const events = executionEventsFrom(result, runId);
        if (!controller.signal.aborted) setJournal({ events, loaded: true, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setJournal((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error) }));
      });
    return () => controller.abort();
  }, [active, runId, revision, reload]);

  const executions = useMemo(() => projectExecutions(journal.events, view), [journal.events, view]);
  const filtered = useMemo(() => filterExecutions(executions, query, "all").filter((execution) => statuses.length === 0 || statuses.includes(execution.status)), [executions, query, statuses]);
  const running = executions.some((execution) => execution.status === "running");
  useEffect(() => {
    if (!active || !running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active, running]);

  return <section aria-label="TypeScript executions" className="flex h-full min-h-0 min-w-0 flex-col text-[0.78rem] text-foreground">
    <header className="px-4 pt-4 pb-3"><h2 className="mb-2 text-[0.92rem]">Executions</h2><p className="leading-[1.5] text-muted-foreground">TypeScript snippets of all actors in this run.</p></header>
    <div className="flex flex-wrap items-center gap-2 border-b border-border-soft px-4 pb-3">
      <SearchInput className="min-w-0" size="sm" aria-label="Search executions" onValueChange={setQuery} placeholder="Search actor, code or result" value={query} />
      <FilterSelect label="Status" options={statusOptions.map((option) => ({ ...option, count: executions.filter((execution) => execution.status === option.value).length }))}
        size="sm" value={statuses} onValueChange={setStatuses} />
      <span className="self-center text-right text-[0.68rem] text-muted-foreground" role="status">{journal.loading ? (journal.loaded ? "Refreshing ..." : "Loading ...") : journal.loaded ? `${filtered.length} of ${executions.length} executions` : "Not loaded yet"}</span>
    </div>
    {journal.error && <Alert className="mx-4 my-2 w-auto" variant="destructive"><AlertDescription className="whitespace-pre-wrap text-destructive [overflow-wrap:anywhere]">{journal.error}{journal.loaded ? " The last loaded state stays visible." : ""}</AlertDescription><Button disabled={!active || journal.loading} onClick={() => setReload((value) => value + 1)} size="sm" variant="ghost">Reload</Button></Alert>}
    <div aria-label="Executions, newest first" className="min-h-0 flex-1 overflow-auto overscroll-contain px-3 pb-3">
      {journal.loaded && !journal.loading && filtered.length === 0 && <p className="mx-0.5 my-4 leading-[1.6] text-muted-foreground">{executions.length === 0 ? "No TypeScript snippet has been executed in this run yet." : "No executions match this search."}</p>}
      {filtered.map((execution) => <ExecutionEntry execution={execution} key={execution.key} now={now} />)}
    </div>
  </section>;
}

const statusTones: Readonly<Record<ExecutionStatus, BadgeTone>> = {
  running: "active",
  completed: "success",
  failed: "danger",
  interrupted: "warning",
};

const summaryClass = "relative grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2 pt-3 pr-3 pb-3 pl-[25px] focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2 [&::-webkit-details-marker]:hidden before:absolute before:top-[15px] before:left-2.5 before:size-[5px] before:rotate-[-45deg] before:border-r-[1.5px] before:border-b-[1.5px] before:border-solid before:border-current before:content-['']";

const contentClass = "min-w-0 border-t border-border-soft px-3 pb-3 [&>h3]:mt-3 [&>h3]:mb-2 [&>h3]:text-[0.72rem] [&>h3]:font-[650]";

const sourceClass = "m-0 max-h-[28rem] overflow-auto";

const logClass = "m-0 max-h-[24rem] overflow-auto rounded-sm border border-code-border bg-code p-2 font-mono text-[0.75rem] leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere]";

function ExecutionEntry({ execution, now }: { execution: TypeScriptExecution; now: number }) {
  const [expanded, setExpanded] = useState(false);
  const preview = execution.code?.trim().split("\n").find((line) => line.trim()) ?? execution.path ?? "TypeScript snippet";
  return <details className="mt-3 overflow-hidden rounded-sm border border-border bg-card open:[&>summary]:before:rotate-45" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary className={summaryClass}>
      <span className="truncate font-[650]" title={`${execution.actorName} (${execution.actorId})`}>@{execution.actorHandle}</span>
      <Badge tone={statusTones[execution.status]}>{executionStatusLabel(execution.status)}</Badge>
      <span className="col-span-full truncate font-mono text-[0.75rem]" title={preview}>{preview}</span>
      <span className="col-span-full flex flex-wrap justify-between gap-x-3 gap-y-2 text-xs tabular-nums text-muted-foreground"><time dateTime={execution.startedAt} title={new Date(execution.startedAt).toLocaleString()}>{new Date(execution.startedAt).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><span>{executionDuration(execution, now)}</span></span>
    </summary>
    {expanded && <div className={contentClass}>
      {execution.path && <p className="mt-3 grid gap-1 text-[0.68rem] text-muted-foreground"><span>Path</span><code className="[overflow-wrap:anywhere]">{execution.path}</code></p>}
      <h3>Code</h3>
      {execution.code !== null ? <SourceCode className={sourceClass} content={execution.code} language="typescript" path={execution.path ?? "snippet.ts"} /> : <p className="text-[0.72rem] leading-[1.5] text-muted-foreground">{execution.path ? "No historical code is stored for this path call." : "No historical code is stored for this call."}</p>}
      {execution.logs.length > 0 && <><h3>Logs</h3><pre className={logClass}>{execution.logs.join("\n")}</pre></>}
      {execution.result !== undefined && <><h3>Result</h3><SourceCode className={sourceClass} content={JSON.stringify(execution.result, null, 2)} language="json" path="result.json" /></>}
      {execution.error && <><h3>{execution.status === "interrupted" ? "Interruption" : "Error"}</h3><pre className={`${logClass} text-destructive`}>{execution.error}</pre></>}
    </div>}
  </details>;
}

export function IconExecutions() {
  return <svg aria-hidden fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15"><path d="m7 7-4 5 4 5m10-10 4 5-4 5M14 4l-4 16" /></svg>;
}
