import { cn } from "cn";
import { CircleAlertIcon, EyeIcon, FolderIcon, GitBranchIcon, Share2Icon, Trash2Icon, UsersIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { sharedWithYouLabel } from "../run-sharing";
import { Button, InteractiveItem, Checkbox, longTime, RunStateIcon, shortTime } from "../ui";
import type { ConnectionRun, ConnectionView } from "./contract";
import { ConfirmDialog } from "./PanelDialogs";

const lineClass = "grid grid-cols-subgrid items-center gap-y-0.5 rounded-md px-2 py-1.5 text-left";

const DETAIL_ICONS = { folder: FolderIcon, branch: GitBranchIcon } as const;

export const canDeleteRun = (connection: ConnectionView, run: ConnectionRun): boolean => connection.canDelete !== false && run.sharedAccess === undefined;

const columnsOf = (selecting: boolean, actions: boolean): string => {
  if (actions) return selecting
    ? "grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]"
    : "grid-cols-[auto_minmax(0,1fr)_auto_auto]";
  return selecting
    ? "grid-cols-[auto_auto_minmax(0,1fr)_auto]"
    : "grid-cols-[auto_minmax(0,1fr)_auto]";
};

/** The clickable item spans every column but the checkbox and the row action. */
const itemColumns = (selecting: boolean, actions: boolean): string =>
  selecting ? (actions ? "col-[2/-2]" : "col-[2/-1]") : (actions ? "col-[1/-2]" : "col-span-full");

/** The list of run lines: a grid whose columns the rows share via subgrid so everything lines up. */
export function RunList({ label, selecting = false, actions = false, children }: {
  label: string;
  selecting?: boolean;
  /** At least one row offers its action at the row end. */
  actions?: boolean;
  children: ReactNode;
}) {
  return <ul aria-label={label} className={cn("grid min-w-0 gap-x-2 gap-y-0.5", columnsOf(selecting, actions))}>{children}</ul>;
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

/** One item per run, with state, title, time, owner, and metadata. */
export function RunLine({ run, selecting = false, selectable = true, selected, actions = false, onOpen, onToggle, onShare, onDelete }: {
  run: ConnectionRun;
  selecting?: boolean;
  /** In selection mode, a row that cannot be selected keeps an empty checkbox cell and still opens its run. */
  selectable?: boolean;
  selected?: boolean;
  /** The list has the column for the row action. */
  actions?: boolean;
  onOpen: () => void;
  onToggle?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const time = shortTime(run.updatedAt);
  const locked = run.locked !== undefined ? `Locked: ${run.locked}` : undefined;
  const toggling = selecting && selectable;
  return <li className="col-span-full grid grid-cols-subgrid items-center">
    {selecting && (selectable
      ? <Checkbox aria-label={`Select ${run.title}`} checked={selected === true} className="mt-1.75 ml-1 self-start" onCheckedChange={() => onToggle?.()} />
      : <span aria-hidden />)}
    <InteractiveItem aria-pressed={toggling ? selected === true : undefined} aria-disabled={run.locked !== undefined && !toggling} className={cn(lineClass, itemColumns(selecting, actions), "aria-disabled:cursor-default")}
      onClick={() => (toggling ? onToggle?.() : run.locked === undefined && onOpen())} title={run.title} type="button">
      <RunStateIcon notice={run.locked ? undefined : run.notice} open={run.pendingActions} state={run.state} />
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate type-item">{run.title}</span>
        {locked !== undefined && <span className="flex flex-none text-destructive" title={locked}><CircleAlertIcon aria-hidden className="size-3.5" /><span className="sr-only">{locked}</span></span>}
        <ShareMark run={run} />
      </span>
      <span className="w-[42px] text-right font-mono type-meta text-muted-foreground" data-cell="time" title={longTime(run.updatedAt)}>{time}</span>
      <RunDetails run={run} />
    </InteractiveItem>
    {actions && <span className="mt-0.5 flex self-start" data-cell="share">
      {onShare && <Button aria-label={`Share ${run.title}`} className="text-muted-foreground" onClick={onShare} size="icon-sm" title="Share ..." type="button" variant="ghost"><Share2Icon /></Button>}
      {onDelete && <Button aria-label={`Delete ${run.title}`} className="text-muted-foreground hover:text-destructive" onClick={() => setConfirming(true)} size="icon-sm" title="Delete run ..." type="button" variant="ghost"><Trash2Icon /></Button>}
    </span>}
    {confirming && onDelete && <ConfirmDialog confirmLabel="Delete" onClose={() => setConfirming(false)}
      onConfirm={() => { setConfirming(false); onDelete(); }} title="Delete one run?">
      The run "{run.title}" is removed from its server along with its journal. This cannot be undone.
    </ConfirmDialog>}
  </li>;
}
