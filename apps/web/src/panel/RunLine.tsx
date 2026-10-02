import { cn } from "cn";
import { CircleAlertIcon, EyeIcon, FolderIcon, GitBranchIcon, Share2Icon, UsersIcon } from "lucide-react";
import type { ReactNode } from "react";
import { sharedWithYouLabel } from "../run-sharing";
import { Button, Checkbox, longTime, RunStateIcon, shortTime } from "../ui";
import type { ConnectionRun, ConnectionView } from "./contract";

const lineClass = "grid grid-cols-subgrid items-center gap-y-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent"
  + " focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/60";

const DETAIL_ICONS = { folder: FolderIcon, branch: GitBranchIcon } as const;

/** The list columns: checkbox (only in selection mode), state, title, time, server (only with two or more servers), and the row action (only when a row can be shared). */
const columnsOf = (showConnection: boolean, selecting: boolean, actions: boolean): string => {
  if (actions) return selecting
    ? (showConnection ? "grid-cols-[auto_auto_minmax(0,1fr)_auto_auto_auto]" : "grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]")
    : (showConnection ? "grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]" : "grid-cols-[auto_minmax(0,1fr)_auto_auto]");
  return selecting
    ? (showConnection ? "grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]" : "grid-cols-[auto_auto_minmax(0,1fr)_auto]")
    : (showConnection ? "grid-cols-[auto_minmax(0,1fr)_auto_auto]" : "grid-cols-[auto_minmax(0,1fr)_auto]");
};

/** The clickable item spans every column but the checkbox and the row action. */
const itemColumns = (selecting: boolean, actions: boolean): string =>
  selecting ? (actions ? "col-[2/-2]" : "col-[2/-1]") : (actions ? "col-[1/-2]" : "col-span-full");

/** The list of run lines: a grid whose columns the rows share via subgrid so everything lines up. */
export function RunList({ label, showConnection, selecting = false, actions = false, children }: {
  label: string;
  showConnection: boolean;
  selecting?: boolean;
  /** At least one row offers its action at the row end. */
  actions?: boolean;
  children: ReactNode;
}) {
  return <ul aria-label={label} className={cn("grid min-w-0 gap-x-2 gap-y-0.5", columnsOf(showConnection, selecting, actions))}>{children}</ul>;
}

/** Next to the title: a run the user shared, or one shared with the user and what that permits. */
function ShareMark({ run }: { run: ConnectionRun }) {
  const label = run.sharedAccess !== undefined ? sharedWithYouLabel(run.sharedAccess) : run.shared ? "Shared" : undefined;
  if (label === undefined) return null;
  const Icon = run.sharedAccess === "read" ? EyeIcon : UsersIcon;
  return <span className="flex flex-none text-muted-foreground" title={label}><Icon aria-hidden className="size-3.5" /><span className="sr-only">{label}</span></span>;
}

/** Owner and the metadata lines below the title; part of the clickable item. */
function RunDetails({ run }: { run: ConnectionRun }) {
  if (run.owner === undefined && (run.details ?? []).length === 0) return null;
  return <span className="col-[2/-1] flex min-w-0 flex-wrap gap-x-3 type-meta text-muted-foreground">
    {run.owner !== undefined && <span className="min-w-0 truncate" title={`Owner: ${run.owner}`}>{run.owner}</span>}
    {run.details?.map((detail, index) => {
      const Icon = detail.icon === undefined ? undefined : DETAIL_ICONS[detail.icon];
      return <span className="flex max-w-full min-w-0 items-center gap-1" key={`${detail.label}:${index}`} title={`${detail.label}: ${detail.text}`}>
        {Icon && <Icon aria-hidden className="size-3 flex-none" />}
        <span className="truncate">{detail.text}</span>
      </span>;
    })}
  </span>;
}

/** One item per run, the same on Start and on Runs: state and title on the left, time and server on the right in the list columns, owner and metadata below the title. */
export function RunLine({ connection, run, showConnection, selecting = false, selectable = true, selected, actions = false, onOpen, onToggle, onShare }: {
  connection: ConnectionView;
  run: ConnectionRun;
  showConnection: boolean;
  selecting?: boolean;
  /** In selection mode, a row that cannot be selected keeps an empty checkbox cell and still opens its run. */
  selectable?: boolean;
  selected?: boolean;
  /** The list has the column for the row action. */
  actions?: boolean;
  onOpen: () => void;
  onToggle?: () => void;
  /** Opens the share dialog; without it, the action cell stays empty. */
  onShare?: () => void;
}) {
  const time = shortTime(run.updatedAt);
  const locked = run.locked !== undefined ? `Locked: ${run.locked}` : undefined;
  const toggling = selecting && selectable;
  return <li className="col-span-full grid grid-cols-subgrid items-center">
    {selecting && (selectable
      ? <Checkbox aria-label={`Select ${run.title}`} checked={selected === true} className="mt-1.75 ml-1 self-start" onCheckedChange={() => onToggle?.()} />
      : <span aria-hidden />)}
    <button aria-disabled={run.locked !== undefined && !toggling} className={cn(lineClass, itemColumns(selecting, actions), "aria-disabled:cursor-default aria-disabled:hover:bg-transparent")}
      onClick={() => (toggling ? onToggle?.() : run.locked === undefined && onOpen())} title={showConnection ? `${run.title} (${connection.name})` : run.title} type="button">
      <RunStateIcon notice={run.locked ? undefined : run.notice} open={run.pendingActions} state={run.state} />
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate type-item">{run.title}</span>
        {locked !== undefined && <span className="flex flex-none text-destructive" title={locked}><CircleAlertIcon aria-hidden className="size-3.5" /><span className="sr-only">{locked}</span></span>}
        <ShareMark run={run} />
      </span>
      <span className="w-[42px] text-right font-mono type-meta text-muted-foreground" data-cell="time" title={longTime(run.updatedAt)}>{time}</span>
      {showConnection && <span className="max-w-[92px] truncate type-meta text-muted-foreground" data-cell="connection" title={connection.name}>{connection.name}</span>}
      <RunDetails run={run} />
    </button>
    {actions && (onShare
      ? <Button aria-label={`Share ${run.title}`} className="mt-0.5 self-start text-muted-foreground" data-cell="share" onClick={onShare} size="icon-sm" title="Share ..." type="button" variant="ghost"><Share2Icon /></Button>
      : <span aria-hidden data-cell="share" />)}
  </li>;
}
