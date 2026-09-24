import { CheckSquareIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button, Input, Toggle } from "../ui";
import type { TargetRun, TargetView } from "./contract";
import type { PanelPageProps } from "./page-props";
import { ConfirmDialog } from "./PanelDialogs";
import { PanelHeader } from "./PanelHeader";
import { RunLine, RunList } from "./RunLine";

const keyOf = (target: string, runId: string): string => `${target}\u0000${runId}`;

const matches = (target: TargetView, run: TargetRun, query: string): boolean =>
  `${run.title} ${target.name}`.toLocaleLowerCase("de-DE").includes(query);

/** Alle Runs aller Umgebungen als eine Liste: Suche, beendete ausblenden, der Umgebungsfilter vom Chip auf Start und eine Mehrfachauswahl zum Löschen. */
export function RunsPage({ state, send }: PanelPageProps) {
  const [query, setQuery] = useState("");
  const [environment, setEnvironment] = useState(state.runsEnvironment);
  const [hideEnded, setHideEnded] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const marked = state.targets.length > 1;
  const all = state.targets.flatMap((target) => target.runs.map((run) => ({ target, run })))
    .sort((left, right) => right.run.updatedAt - left.run.updatedAt);
  const needle = query.trim().toLocaleLowerCase("de-DE");
  const shown = all
    .filter(({ target }) => environment === undefined || target.name === environment)
    .filter(({ run }) => !hideEnded || run.state !== "ended")
    .filter(({ target, run }) => needle === "" || matches(target, run, needle));
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
    for (const target of state.targets) {
      const runIds = target.runs.filter((run) => selected.has(keyOf(target.name, run.id))).map((run) => run.id);
      if (runIds.length > 0) send({ action: "deleteRuns", name: target.name, runIds });
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
      {environment !== undefined && <Toggle aria-label={`Nur ${environment}`} onPressedChange={() => setEnvironment(undefined)} pressed size="sm" title={`Nur Runs auf ${environment}; Klick zeigt alle`} variant="outline">
        {environment}<XIcon data-icon="inline-end" />
      </Toggle>}
      <Toggle onPressedChange={setHideEnded} pressed={hideEnded} size="sm" variant="outline">Beendete ausblenden</Toggle>
      <Toggle onPressedChange={(next) => (next ? setSelecting(true) : leaveSelection())} pressed={selecting} size="sm" variant="outline">
        <CheckSquareIcon data-icon="inline-start" />Auswählen
      </Toggle>
    </div>
    {shown.length === 0
      ? <p className="text-[0.75rem] text-muted-foreground" role="status">{all.length === 0 ? "Noch keine Runs." : "Kein passender Run."}</p>
      : <RunList environment={marked} label="Runs" selecting={selecting}>
        {shown.map(({ target, run }) => <RunLine environment={marked} key={keyOf(target.name, run.id)}
          onOpen={() => send({ action: "openRun", name: target.name, runId: run.id })}
          onToggle={() => toggle(keyOf(target.name, run.id))} run={run} selected={selected.has(keyOf(target.name, run.id))} selecting={selecting} target={target} />)}
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
      Die gewählten Runs verschwinden mit ihren Journalen von ihrer Umgebung. Das lässt sich nicht rückgängig machen.
    </ConfirmDialog>}
  </div>;
}
