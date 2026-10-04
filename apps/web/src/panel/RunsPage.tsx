import { CheckSquareIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button, Input, Toggle } from "../ui";
import type { ConnectionRun, ConnectionView } from "./contract";
import type { PanelPageProps } from "./page-props";
import { ConfirmDialog } from "./PanelDialogs";
import { PanelHeader } from "./PanelHeader";
import { RunLine, RunList } from "./RunLine";

const matches = (run: ConnectionRun, query: string): boolean => run.title.toLocaleLowerCase("en-US").includes(query);

/** A run shared with the user stays with its owner; the selection never deletes it. */
const deletable = (connection: ConnectionView, run: ConnectionRun): boolean => connection.canDelete !== false && run.sharedAccess === undefined;

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
  const sharing = !selecting && shown.some((run) => run.canShare === true);
  const leaveSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggle = (key: string) => setSelected((current) => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  const remove = () => {
    const runIds = connection.runs.filter((run) => deletable(connection, run) && selected.has(run.id)).map((run) => run.id);
    if (runIds.length > 0) send({ action: "deleteRuns", name: connection.name, runIds });
    setConfirming(false);
    leaveSelection();
  };
  return <div className="grid grid-cols-1 gap-3">
    <PanelHeader send={send} title="Runs" />
    <div className="relative">
      <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input aria-label="Search runs" className="h-8 pl-8 text-sm" onChange={(event) => setQuery(event.target.value)}
        placeholder="Search runs ..." type="search" value={query} />
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      <Toggle onPressedChange={setHideEnded} pressed={hideEnded} size="sm" variant="outline">Hide ended</Toggle>
      {connection.canDelete !== false && <Toggle onPressedChange={(next) => (next ? setSelecting(true) : leaveSelection())} pressed={selecting} size="sm" variant="outline">
        <CheckSquareIcon data-icon="inline-start" />Select
      </Toggle>}
    </div>
    {shown.length === 0
      ? <p className="type-body text-muted-foreground" role="status">{all.length === 0 ? "No runs yet." : "No matching run."}</p>
      : <RunList actions={sharing} label="Runs" selecting={selecting}>
        {shown.map((run) => <RunLine actions={sharing} key={run.id}
          onOpen={() => send({ action: "openRun", name: connection.name, runId: run.id })}
          onShare={run.canShare ? () => send({ action: "openSharing", name: connection.name, runId: run.id }) : undefined}
          onToggle={() => toggle(run.id)} run={run} selectable={deletable(connection, run)} selected={selected.has(run.id)} selecting={selecting} />)}
      </RunList>}
    {selecting && <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border-soft bg-background py-2">
      <span className="flex-1 type-body text-muted-foreground" role="status">{selected.size} selected</span>
      <Button disabled={selected.size === 0} onClick={() => setConfirming(true)} size="xs" variant="destructive"><Trash2Icon data-icon="inline-start" />Delete</Button>
      <Button onClick={leaveSelection} size="xs" variant="ghost">Cancel</Button>
    </div>}
    {confirming && <ConfirmDialog
      confirmLabel="Delete"
      onClose={() => setConfirming(false)}
      onConfirm={remove}
      title={selected.size === 1 ? "Delete one run?" : `Delete ${selected.size} runs?`}>
      The selected runs are removed from their server along with their journals. This cannot be undone.
    </ConfirmDialog>}
  </div>;
}
