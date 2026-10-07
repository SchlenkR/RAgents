import { CheckSquareIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button, Toggle } from "../ui";
import { SearchInput } from "../ui/search-input";
import type { ConnectionRun } from "./contract";
import type { PanelPageProps } from "./page-props";
import { ConfirmDialog } from "./PanelDialogs";
import { PanelHeader } from "./PanelHeader";
import { canDeleteRun, RunCard, RunLine, RunList } from "./RunLine";

const matches = (run: ConnectionRun, query: string): boolean => run.title.toLocaleLowerCase("en-US").includes(query);

/** The current server's runs with search, hide ended, and a multi-selection for deleting. */
export function RunsPage({ state, send }: PanelPageProps) {
  const [query, setQuery] = useState("");
  const [hideEnded, setHideEnded] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const connection = state.connections[0]!;
  const all = [...connection.runs]
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const needle = query.trim().toLocaleLowerCase("en-US");
  const shown = all
    .filter((run) => !hideEnded || run.state !== "ended")
    .filter((run) => needle === "" || matches(run, needle));
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
  const remove = () => {
    const runIds = selectedRuns.map((run) => run.id);
    if (runIds.length > 0) send({ action: "deleteRuns", name: connection.name, runIds });
    setConfirming(false);
    leaveSelection();
  };
  return <div className="grid grid-cols-1 gap-3">
    <PanelHeader send={send} title="Runs" />
    {state.problem && <p className="type-body text-destructive [overflow-wrap:anywhere]" role="alert">{state.problem}</p>}
    <RunCard toolbar={<div className="flex flex-wrap items-center gap-2">
      <SearchInput aria-label="Search runs" className="min-w-[min(12rem,100%)] flex-1" icon onValueChange={setQuery} placeholder="Search runs ..." size="sm" value={query} />
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
    {confirming && <ConfirmDialog
      confirmLabel="Delete"
      onClose={() => setConfirming(false)}
      onConfirm={remove}
      title={selectedRuns.length === 1 ? "Delete one run?" : `Delete ${selectedRuns.length} runs?`}>
      The selected runs are removed from their server along with their journals. This cannot be undone.
    </ConfirmDialog>}
  </div>;
}
