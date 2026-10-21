import { CheckSquareIcon, Trash2Icon } from "lucide-react";
import { useCallback, useState } from "react";
import { StartTiles } from "../StartTiles";
import { Button, OverflowTabs, OverflowTabsList, TabsContent, Toggle } from "../ui";
import { SearchInput } from "../ui/search-input";
import type { ConnectionRun, PanelAction, PanelState } from "./contract";
import type { PanelPageProps } from "./page-props";
import { ConfirmDialog } from "./PanelDialogs";
import { canDeleteRun, RunCard, RunLine, RunList } from "./RunLine";
import { SharedRuns } from "./SharedRuns";

const matches = (run: ConnectionRun, query: string): boolean => run.title.toLocaleLowerCase("en-US").includes(query);

type NewRun = Extract<PanelAction, { action: "newRun" }>;

interface PendingStart {
  readonly action: NewRun;
  readonly state: PanelState;
}

/** The current server's runs with search, hide ended, and a multi-selection for deleting. */
export function RunsPage({ state, send }: PanelPageProps) {
  const [start, setStart] = useState<PendingStart>();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [hideEnded, setHideEnded] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const connection = state.connections[0]!;
  const starting = start?.state === state ? start.action : undefined;
  const startRun = useCallback((entryId?: string) => {
    const action: NewRun = entryId === undefined ? { action: "newRun", name: connection.name } : { action: "newRun", name: connection.name, entryId };
    send(action);
    setStart({ action, state });
  }, [connection.name, send, state]);
  const all = [...connection.runs]
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const needle = query.trim().toLocaleLowerCase("en-US");
  const shown = all
    .filter((run) => !hideEnded || run.state !== "ended")
    .filter((run) => needle === "" || matches(run, needle));
  const shared = all.filter((run) => run.sharing !== undefined && (run.sharing.everyone !== null || run.sharing.users.length > 0));
  const sharedShown = shared.filter((run) => needle === "" || matches(run, needle)
    || run.sharing!.users.some((user) => user.label.toLocaleLowerCase("en-US").includes(needle))
    || run.sharing!.everyone !== null && "everyone".includes(needle));
  const selectable = shown.filter((run) => canDeleteRun(connection, run));
  const allSelected = selectable.length > 0 && selectable.every((run) => selected.has(run.id));
  const selectedRuns = connection.runs.filter((run) => canDeleteRun(connection, run) && selected.has(run.id));
  const actions = !selecting && shown.some((run) => run.canShare === true || canDeleteRun(connection, run));
  const leaveSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggle = (key: string) => setSelected((current) => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  const toggleAll = () => setSelected((current) => {
    const next = new Set(current);
    for (const run of selectable) {
      if (allSelected) next.delete(run.id);
      else next.add(run.id);
    }
    return next;
  });
  const search = <SearchInput aria-label="Search runs" className="min-w-[min(12rem,100%)] flex-1" icon onValueChange={setQuery} placeholder="Search runs ..." size="sm" value={query} />;
  const remove = () => {
    const runIds = selectedRuns.map((run) => run.id);
    if (runIds.length > 0) send({ action: "deleteRuns", name: connection.name, runIds });
    setConfirming(false);
    leaveSelection();
  };
  return <div className="grid min-w-0 grid-cols-1 gap-4">
    <h1 className="type-title">Runs</h1>
    {state.problem && <p className="type-body text-destructive [overflow-wrap:anywhere]" role="alert">{state.problem}</p>}
    {state.notice && <p className="type-body text-muted-foreground [overflow-wrap:anywhere]" role="status">{state.notice}</p>}
    <div className={`grid min-w-0 grid-cols-1 items-start gap-6 ${connection.canCreate ? "@min-[960px]/panel:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" : ""}`}>
      {connection.canCreate && <section aria-label="New run" className="grid min-w-0 gap-3">
        <h2 className="type-label">New run</h2>
        <StartTiles defaultEntry={connection.defaultEntry} disabled={starting !== undefined} entries={connection.entries} label="Templates"
          onNewChat={connection.canCreateFree === false ? undefined : () => startRun()} onStart={startRun} starting={starting} />
      </section>}
      <section aria-label="Run list" className="min-w-0">
        <OverflowTabs value={tab} onValueChange={(next) => { setTab(next); leaveSelection(); }}>
          <OverflowTabsList aria-label="Run views" items={[{ value: "all", label: "All runs" }, { value: "shared", label: "Shared by me", count: shared.length }]} />
          <TabsContent value="all">
            <RunCard toolbar={<div className="flex flex-wrap items-center gap-2">
              {search}
              <div aria-label="Run actions" className="flex flex-wrap items-center gap-2" role="group">
                {selecting ? <>
                  <Button disabled={selectable.length === 0} onClick={toggleAll} size="sm" variant="outline">{allSelected ? "Select none" : "Select all"}</Button>
                  <span className="type-body text-muted-foreground" role="status">{selectedRuns.length} selected</span>
                  <Button disabled={selectedRuns.length === 0} onClick={() => setConfirming(true)} size="sm" variant="destructive"><Trash2Icon data-icon="inline-start" />Delete</Button>
                  <Button onClick={leaveSelection} size="sm" variant="outline">Cancel</Button>
                </> : <>
                  <Toggle onPressedChange={setHideEnded} pressed={hideEnded} size="sm" variant="outline">Hide ended</Toggle>
                  {connection.canDelete !== false && <Toggle onPressedChange={setSelecting} pressed={selecting} size="sm" variant="outline">
                    <CheckSquareIcon data-icon="inline-start" />Select
                  </Toggle>}
                </>}
              </div>
            </div>}>
              {shown.length === 0
                ? <p className="type-body px-3 py-4 text-muted-foreground" role="status">{all.length === 0 ? "No runs yet." : "No matching run."}</p>
                : <RunList actions={actions} label="Runs" selecting={selecting}>
                  {shown.map((run) => <RunLine actions={actions} key={run.id}
                    onDelete={!selecting && canDeleteRun(connection, run) ? () => send({ action: "deleteRuns", name: connection.name, runIds: [run.id] }) : undefined}
                    onOpen={() => send({ action: "openRun", name: connection.name, runId: run.id })}
                    onShare={run.canShare ? () => send(state.sharing?.runId === run.id ? { action: "closeSharing" } : { action: "openSharing", name: connection.name, runId: run.id }) : undefined}
                    sharingOpen={state.sharing?.runId === run.id}
                    onToggle={() => toggle(run.id)} run={run} selectable={canDeleteRun(connection, run)} selected={selected.has(run.id)} selecting={selecting} />)}
                </RunList>}
            </RunCard>
          </TabsContent>
          <TabsContent value="shared">
            <RunCard toolbar={<div className="flex flex-wrap items-center gap-2">{search}</div>}>
              {sharedShown.length === 0
                ? <p className="type-body px-3 py-4 text-muted-foreground" role="status">{shared.length === 0 ? "You have not shared any runs." : "No matching shared run."}</p>
                : <SharedRuns runs={sharedShown} revoking={state.revoking}
                  onOpen={(runId) => send({ action: "openRun", name: connection.name, runId })}
                  onRevoke={(runId, target) => send({ action: "revokeShare", name: connection.name, runId, target })} />}
            </RunCard>
          </TabsContent>
        </OverflowTabs>
      </section>
    </div>
    {confirming && <ConfirmDialog
      confirmLabel="Delete"
      onClose={() => setConfirming(false)}
      onConfirm={remove}
      title={selectedRuns.length === 1 ? "Delete one run?" : `Delete ${selectedRuns.length} runs?`}>
      The selected runs are removed from their server along with their journals. This cannot be undone.
    </ConfirmDialog>}
  </div>;
}
