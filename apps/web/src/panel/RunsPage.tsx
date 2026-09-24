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
  `${run.title} ${connection.name}`.toLocaleLowerCase("de-DE").includes(query);

/** Alle Runs aller Server als eine Liste: Suche, beendete ausblenden, der Serverfilter vom Chip auf Start und eine Mehrfachauswahl zum Löschen. */
export function RunsPage({ state, send }: PanelPageProps) {
  const [query, setQuery] = useState("");
  const [onlyConnection, setOnlyConnection] = useState(state.runsConnection);
  const [hideEnded, setHideEnded] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const marked = state.connections.length > 1;
  const all = state.connections.flatMap((connection) => connection.runs.map((run) => ({ connection, run })))
    .sort((left, right) => right.run.updatedAt - left.run.updatedAt);
  const needle = query.trim().toLocaleLowerCase("de-DE");
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
    for (const connection of state.connections) {
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
      <Input aria-label="Runs suchen" className="h-8 pl-8 text-[0.76rem]" onChange={(event) => setQuery(event.target.value)}
        placeholder="Runs suchen ..." type="search" value={query} />
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      {onlyConnection !== undefined && <Toggle aria-label={`Nur ${onlyConnection}`} onPressedChange={() => setOnlyConnection(undefined)} pressed size="sm" title={`Nur Runs auf ${onlyConnection}; Klick zeigt alle`} variant="outline">
        {onlyConnection}<XIcon data-icon="inline-end" />
      </Toggle>}
      <Toggle onPressedChange={setHideEnded} pressed={hideEnded} size="sm" variant="outline">Beendete ausblenden</Toggle>
      <Toggle onPressedChange={(next) => (next ? setSelecting(true) : leaveSelection())} pressed={selecting} size="sm" variant="outline">
        <CheckSquareIcon data-icon="inline-start" />Auswählen
      </Toggle>
    </div>
    {shown.length === 0
      ? <p className="text-[0.75rem] text-muted-foreground" role="status">{all.length === 0 ? "Noch keine Runs." : "Kein passender Run."}</p>
      : <RunList label="Runs" selecting={selecting} showConnection={marked}>
        {shown.map(({ connection, run }) => <RunLine connection={connection} key={keyOf(connection.name, run.id)}
          onOpen={() => send({ action: "openRun", name: connection.name, runId: run.id })}
          onToggle={() => toggle(keyOf(connection.name, run.id))} run={run} selected={selected.has(keyOf(connection.name, run.id))} selecting={selecting} showConnection={marked} />)}
      </RunList>}
    {selecting && <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border-soft bg-background py-2">
      <span className="flex-1 text-[0.72rem] text-muted-foreground" role="status">{selected.size} ausgewählt</span>
      <Button disabled={selected.size === 0} onClick={() => setConfirming(true)} size="xs" variant="destructive"><Trash2Icon data-icon="inline-start" />Löschen</Button>
      <Button onClick={leaveSelection} size="xs" variant="ghost">Abbrechen</Button>
    </div>}
    {confirming && <ConfirmDialog
      confirmLabel="Löschen"
      onClose={() => setConfirming(false)}
      onConfirm={remove}
      title={selected.size === 1 ? "Einen Run löschen?" : `${selected.size} Runs löschen?`}>
      Die gewählten Runs verschwinden mit ihren Journalen von ihrem Server. Das lässt sich nicht rückgängig machen.
    </ConfirmDialog>}
  </div>;
}
