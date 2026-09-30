import { CheckSquareIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button, Input, Toggle } from "../ui";
import type { ConnectionRun, ConnectionView } from "./contract";
import type { PanelPageProps } from "./page-props";
import { ConfirmDialog } from "./PanelDialogs";
import { PanelHeader } from "./PanelHeader";
import { RunLine, RunList } from "./RunLine";

const keyOf = (connection: string, runId: string): string => `${connection}\u0000${runId}`;

const matches = (connection: ConnectionView, run: ConnectionRun, query: string): boolean =>
  `${run.title} ${connection.name}`.toLocaleLowerCase("en-US").includes(query);

/** All runs of all servers as one list: search, hide ended, the server filter from the chip on Start, and a multi-selection for deleting. */
export function RunsPage({ state, send, runDetails }: PanelPageProps) {
  const [query, setQuery] = useState("");
  const [onlyConnection, setOnlyConnection] = useState(state.runsConnection);
  const [hideEnded, setHideEnded] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const marked = state.connections.length > 1;
  const all = state.connections.flatMap((connection) => connection.runs.map((run) => ({ connection, run })))
    .sort((left, right) => right.run.updatedAt - left.run.updatedAt);
  const needle = query.trim().toLocaleLowerCase("en-US");
  const shown = all
    .filter(({ connection }) => onlyConnection === undefined || connection.name === onlyConnection)
    .filter(({ run }) => !hideEnded || run.state !== "ended")
    .filter(({ connection, run }) => needle === "" || matches(connection, run, needle));
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
    for (const connection of state.connections.filter((connection) => connection.canDelete !== false)) {
      const runIds = connection.runs.filter((run) => selected.has(keyOf(connection.name, run.id))).map((run) => run.id);
      if (runIds.length > 0) send({ action: "deleteRuns", name: connection.name, runIds });
    }
    setConfirming(false);
    leaveSelection();
  };
  return <div className="grid grid-cols-1 gap-3">
    <PanelHeader send={send} title="Runs" />
    <div className="relative">
      <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input aria-label="Search runs" className="h-8 pl-8 text-[0.76rem]" onChange={(event) => setQuery(event.target.value)}
        placeholder="Search runs ..." type="search" value={query} />
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      {onlyConnection !== undefined && <Toggle aria-label={`Only ${onlyConnection}`} onPressedChange={() => setOnlyConnection(undefined)} pressed size="sm" title={`Only runs on ${onlyConnection}; click to show all`} variant="outline">
        {onlyConnection}<XIcon data-icon="inline-end" />
      </Toggle>}
      <Toggle onPressedChange={setHideEnded} pressed={hideEnded} size="sm" variant="outline">Hide ended</Toggle>
      {state.connections.some((connection) => connection.canDelete !== false) && <Toggle onPressedChange={(next) => (next ? setSelecting(true) : leaveSelection())} pressed={selecting} size="sm" variant="outline">
        <CheckSquareIcon data-icon="inline-start" />Select
      </Toggle>}
    </div>
    {shown.length === 0
      ? <p className="text-[0.75rem] text-muted-foreground" role="status">{all.length === 0 ? "No runs yet." : "No matching run."}</p>
      : <RunList label="Runs" selecting={selecting} showConnection={marked}>
        {shown.map(({ connection, run }) => <RunLine details={runDetails?.(run.id, connection.name)} connection={connection} key={keyOf(connection.name, run.id)}
          onOpen={() => send({ action: "openRun", name: connection.name, runId: run.id })}
          onToggle={() => toggle(keyOf(connection.name, run.id))} run={run} selected={selected.has(keyOf(connection.name, run.id))} selecting={selecting && connection.canDelete !== false} showConnection={marked} />)}
      </RunList>}
    {selecting && <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border-soft bg-background py-2">
      <span className="flex-1 text-[0.72rem] text-muted-foreground" role="status">{selected.size} selected</span>
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
