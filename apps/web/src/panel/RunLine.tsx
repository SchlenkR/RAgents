import { cn } from "cn";
import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Checkbox, longTime, RunStateIcon, shortTime } from "../ui";
import type { ConnectionRun, ConnectionView } from "./contract";

const lineClass = "grid grid-cols-subgrid items-center rounded-md px-2 py-1.5 text-left hover:bg-accent"
  + " focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/60";

/** The list columns: checkbox (only in selection mode), state, title, time, and server (only with two or more servers). */
const columnsOf = (showConnection: boolean, selecting: boolean): string => selecting
  ? (showConnection ? "grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]" : "grid-cols-[auto_auto_minmax(0,1fr)_auto]")
  : (showConnection ? "grid-cols-[auto_minmax(0,1fr)_auto_auto]" : "grid-cols-[auto_minmax(0,1fr)_auto]");

/** The list of run lines: a grid whose columns the rows share via subgrid so everything lines up. */
export function RunList({ label, showConnection, selecting = false, children }: {
  label: string;
  showConnection: boolean;
  selecting?: boolean;
  children: ReactNode;
}) {
  return <ul aria-label={label} className={cn("grid min-w-0 gap-x-2 gap-y-0.5", columnsOf(showConnection, selecting))}>{children}</ul>;
}

/** One line per run, the same on Start and on Runs: state and title on the left, time and server on the right in the list columns. */
export function RunLine({ connection, run, showConnection, selecting, selected, onOpen, onToggle, details }: {
  details?: ReactNode;
  connection: ConnectionView;
  run: ConnectionRun;
  showConnection: boolean;
  selecting?: boolean;
  selected?: boolean;
  onOpen: () => void;
  onToggle?: () => void;
}) {
  const time = shortTime(run.updatedAt);
  const problem = run.locked !== undefined ? `Locked: ${run.locked}` : run.problem;
  return <li className="col-span-full grid grid-cols-subgrid items-center">
    {selecting && <Checkbox aria-label={`Select ${run.title}`} checked={selected === true} className="ml-1" onCheckedChange={() => onToggle?.()} />}
    <button aria-disabled={run.locked !== undefined && !selecting} className={cn(lineClass, selecting ? "col-[2/-1]" : "col-span-full", "aria-disabled:cursor-default aria-disabled:hover:bg-transparent")}
      onClick={() => (selecting ? onToggle?.() : run.locked === undefined && onOpen())} title={showConnection ? `${run.title} (${connection.name})` : run.title} type="button">
      <RunStateIcon notice={run.locked ? undefined : run.notice} open={run.pendingActions} state={run.state} />
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate type-item">{run.title}</span>
        {problem !== undefined && <span className="flex flex-none text-destructive" title={problem}><CircleAlertIcon aria-hidden className="size-3.5" /><span className="sr-only">{problem}</span></span>}
      </span>
      <span className="w-[42px] text-right font-mono type-meta text-muted-foreground" data-cell="time" title={longTime(run.updatedAt)}>{time}</span>
      {showConnection && <span className="max-w-[92px] truncate type-meta text-muted-foreground" data-cell="connection" title={connection.name}>{connection.name}</span>}
    </button>
    {details && <div className="col-span-full flex flex-wrap gap-x-3 px-2 pb-1 type-meta text-muted-foreground empty:hidden">{details}</div>}
  </li>;
}
