import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import type { JournalEvent } from "@ragents/engine/src/domain/events";
import type { SessionHeaderContext } from "@ragents/web/PluginRegistry";
import { SourceCode } from "@ragents/web/SourceCode";
import { Button, Input, Popover, PopoverContent } from "@ragents/web/ui";
import { runContracts } from "@ragents/engine/src/http/contracts";
import { rpc } from "@ragents/web/rpc";
import { runViewFrom } from "@ragents/web/run-view";
import { statusControlClass } from "./constants";

export function JournalStatus({ session }: SessionHeaderContext) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<readonly JournalEvent[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(100);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const view = runViewFrom(session.runView);
  const revision = view?.revision;
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void rpc.call(runContracts.events, { runId: session.session.id }, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setEvents(result); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, session.session.id, revision, reload]);

  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("en-US");
    const handles = new Map(view?.actors.map((actor) => [actor.id, actor.handle]));
    return [...events].reverse().filter((event) => !search || `${handles.get(event.actorId) ?? ""} ${JSON.stringify(event)}`.toLocaleLowerCase("en-US").includes(search));
  }, [events, query, view?.actors]);
  const actors = new Map(view?.actors.map((actor) => [actor.id, actor.handle]));

  return <div className="flex h-full min-w-0 items-stretch">
    <button aria-controls={panelId} aria-expanded={open} className={statusControlClass} onClick={() => setOpen((value) => !value)} ref={buttonRef} type="button">
      Journal
    </button>
    <Popover open={open} onOpenChange={(next) => { if (!next) close(); }}>
    <PopoverContent align="start" anchor={buttonRef} aria-label="Journal of the run" className="flex min-h-0 min-w-0 flex-col gap-0 overflow-hidden rounded-t-sm rounded-b-none p-0 text-[0.76rem]" collisionPadding={8} id={panelId}
      initialFocus={searchRef} role="region" side="top" style={{ width: "min(900px, var(--available-width))", height: "min(480px, var(--available-height))" }}>
      <header className="flex flex-none items-center gap-2 border-b border-border-soft px-2.5 py-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-2.5 [&>span]:truncate"><strong>Journal</strong><span className="text-muted-foreground">{session.session.title || "Run"}</span></div>
        <Button onClick={() => setReload((value) => value + 1)} size="sm" variant="ghost">Refresh</Button>
        <Button aria-label="Close journal" onClick={() => close(true)} size="icon-sm" title="Close journal" variant="ghost"><XIcon /></Button>
      </header>
      <div className="flex flex-none items-center gap-3 px-2.5 py-2">
        <Input className="flex-1" aria-label="Search journal" onChange={(event) => { setQuery(event.target.value); setLimit(100); }} placeholder="Search event type, actor or content ..." ref={searchRef} type="search" value={query} />
        <span className="flex-none whitespace-nowrap text-[0.68rem] text-muted-foreground" role="status">{loading ? "Loading ..." : `${filtered.length} events`}</span>
      </div>
      {error && <p className="flex-none px-2.5 pb-2 text-destructive" role="alert">{error}</p>}
      <div aria-label="Journal events, newest first" className="min-h-0 flex-1 overflow-auto overscroll-contain px-2.5 pb-2.5">
        {!loading && !error && filtered.length === 0 && <p className="text-muted-foreground">{query ? "No matching events." : "The journal contains no events yet."}</p>}
        {filtered.slice(0, limit).map((event) => <JournalEntry actor={actors.get(event.actorId)} event={event} key={event.eventId} />)}
        {filtered.length > limit && <Button onClick={() => setLimit((value) => value + 100)} size="sm" variant="outline">Show more events</Button>}
      </div>
    </PopoverContent>
    </Popover>
  </div>;
}

function JournalEntry({ actor, event }: { actor: string | undefined; event: JournalEvent }) {
  const [expanded, setExpanded] = useState(false);
  return <details className="border-b border-border-soft open:[&>summary]:text-primary" onToggle={(toggle) => setExpanded(toggle.currentTarget.open)}>
    <summary className="grid cursor-pointer grid-cols-[32px_minmax(130px,1fr)_minmax(70px,140px)_auto] items-baseline gap-2 px-0.5 py-2 text-[0.68rem] focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2 max-[550px]:grid-cols-[24px_minmax(0,1fr)_auto] max-[550px]:gap-x-2 max-[550px]:gap-y-1">
      <span className="text-muted-foreground tabular-nums">{event.sequence}</span>
      <span className="font-mono [overflow-wrap:anywhere]">{event.type}</span>
      <span className="truncate max-[550px]:col-start-2 max-[550px]:row-start-2" title={event.actorId}>{actor ? `@${actor}` : event.actorId}</span>
      <time className="text-muted-foreground tabular-nums max-[550px]:col-start-3 max-[550px]:row-start-1" dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleTimeString()}</time>
    </summary>
    {expanded && <SourceCode className="m-0 mb-2 text-[0.68rem]" content={JSON.stringify(event, null, 2)} language="json" path="event.json" />}
  </details>;
}
