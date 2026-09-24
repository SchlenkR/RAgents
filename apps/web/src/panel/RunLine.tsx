import { cn } from "cn";
import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Checkbox, longTime, RunStateIcon, shortTime } from "../ui";
import type { ConnectionRun, ConnectionView } from "./contract";

const lineClass = "grid grid-cols-subgrid items-center rounded-md px-2 py-1.5 text-left hover:bg-accent"
  + " focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/60";

/** Die Spalten der Liste: Kontrollkästchen (nur im Auswahlmodus), Zustand, Titel, Zeit und Server (nur ab zwei Servern). */
const columnsOf = (showConnection: boolean, selecting: boolean): string => selecting
  ? (showConnection ? "grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]" : "grid-cols-[auto_auto_minmax(0,1fr)_auto]")
  : (showConnection ? "grid-cols-[auto_minmax(0,1fr)_auto_auto]" : "grid-cols-[auto_minmax(0,1fr)_auto]");

/** Die Liste der Run-Zeilen: ein Raster, dessen Spalten die Zeilen per Subgrid teilen, damit alles untereinander steht. */
export function RunList({ label, showConnection, selecting = false, children }: {
  label: string;
  showConnection: boolean;
  selecting?: boolean;
  children: ReactNode;
}) {
  return <ul aria-label={label} className={cn("-mx-2 grid gap-x-2 gap-y-0.5", columnsOf(showConnection, selecting))}>{children}</ul>;
}

/** Eine Zeile je Run, auf Start wie auf Runs dieselbe: Zustand und Titel links, rechts Zeit und Server in den Spalten der Liste. */
export function RunLine({ connection, run, showConnection, selecting, selected, onOpen, onToggle }: {
  connection: ConnectionView;
  run: ConnectionRun;
  showConnection: boolean;
  selecting?: boolean;
  selected?: boolean;
  onOpen: () => void;
  onToggle?: () => void;
}) {
  const time = shortTime(run.updatedAt);
  return <li className="col-span-full grid grid-cols-subgrid items-center">
    {selecting && <Checkbox aria-label={`${run.title} auswählen`} checked={selected === true} className="ml-1" onCheckedChange={() => onToggle?.()} />}
    <button className={cn(lineClass, selecting ? "col-[2/-1]" : "col-span-full")} onClick={() => (selecting ? onToggle?.() : onOpen())} title={showConnection ? `${run.title} (${connection.name})` : run.title} type="button">
      <RunStateIcon open={run.pendingActions} state={run.state} />
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-[0.8rem] font-medium">{run.title}</span>
        {run.problem !== undefined && <span className="flex flex-none text-destructive" title={run.problem}><CircleAlertIcon aria-hidden className="size-3.5" /><span className="sr-only">{run.problem}</span></span>}
      </span>
      <span className="w-[42px] text-right font-mono text-[0.62rem] text-muted-foreground" data-cell="time" title={longTime(run.updatedAt)}>{time}</span>
      {showConnection && <span className="max-w-[92px] truncate text-[0.64rem] font-semibold text-muted-foreground" data-cell="connection" title={connection.name}>{connection.name}</span>}
    </button>
  </li>;
}
