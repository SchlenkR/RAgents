import {
  CircleAlertIcon, CircleCheckIcon, CircleEllipsisIcon, CircleIcon, CirclePauseIcon, CirclePlayIcon, CircleSlashIcon, CircleXIcon, HourglassIcon, LockIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "cn";
import { connectionStateWord, runStateWord, type ConnectionStateName, type RunStateName } from "./state-vocabulary";

interface Mark {
  readonly Icon: ComponentType<{ className?: string; fill?: string }>;
  readonly tone: string;
  readonly filled?: boolean;
}

/** Green is running, blue is moving, yellow is waiting for you (also a paused run), red is broken, gray is idle, muted is over; no state ever carries the stop glyph (square). */
const RUN_MARKS: Record<RunStateName, Mark> = {
  running: { Icon: CirclePlayIcon, tone: "text-success" },
  waiting: { Icon: CircleEllipsisIcon, tone: "text-warning" },
  paused: { Icon: CirclePauseIcon, tone: "text-warning" },
  idle: { Icon: CircleIcon, tone: "text-muted-foreground" },
  ended: { Icon: CircleCheckIcon, tone: "text-muted-foreground opacity-70" },
  failed: { Icon: CircleXIcon, tone: "text-destructive" },
  cancelled: { Icon: CircleSlashIcon, tone: "text-muted-foreground opacity-70" },
};

const CONNECTION_MARKS: Record<ConnectionStateName, Mark> = {
  connected: { Icon: CircleIcon, tone: "text-success", filled: true },
  ready: { Icon: CircleIcon, tone: "text-success", filled: true },
  starting: { Icon: HourglassIcon, tone: "text-info" },
  "login-required": { Icon: LockIcon, tone: "text-warning" },
  unreachable: { Icon: CircleSlashIcon, tone: "text-destructive" },
  stopped: { Icon: CircleIcon, tone: "text-muted-foreground" },
  failed: { Icon: CircleAlertIcon, tone: "text-destructive" },
  forbidden: { Icon: LockIcon, tone: "text-destructive" },
};

export const runStateTone = (state: RunStateName): string => RUN_MARKS[state].tone;

export const connectionStateTone = (state: ConnectionStateName): string => CONNECTION_MARKS[state].tone;

const markClass = "inline-flex flex-none items-center gap-1";

const NOTICE_WORDS = { unseen: "not viewed yet", updated: "new activity" } as const;

/** The whole run state in one glyph: the tone carries the state, a dot inside the ring says something is new. */
export function RunStateIcon({ state, open = 0, notice, className }: { state: RunStateName; open?: number; notice?: "unseen" | "updated"; className?: string }) {
  const mark = RUN_MARKS[state];
  const word = notice ? `${runStateWord(state, open)}, ${NOTICE_WORDS[notice]}` : runStateWord(state, open);
  const Icon = notice ? CircleIcon : mark.Icon;
  return <span className={cn(markClass, mark.tone, className)} title={word}>
    <span className="relative inline-flex">
      <Icon className="size-3.5" />
      {notice && <span aria-hidden className="absolute inset-0 m-auto size-1.5 rounded-full bg-info" />}
    </span>
    {state === "waiting" && open > 0 && <span aria-hidden className="font-mono text-[0.62rem] font-semibold leading-none">{open}</span>}
    <span className="sr-only">{word}</span>
  </span>;
}

export function ConnectionStateIcon({ state, className }: { state: ConnectionStateName; className?: string }) {
  const mark = CONNECTION_MARKS[state];
  const word = connectionStateWord(state);
  const Icon = mark.Icon;
  return <span className={cn(markClass, mark.tone, className)} title={word}>
    <Icon className="size-3.5" {...(mark.filled ? { fill: "currentColor" } : {})} />
    <span className="sr-only">{word}</span>
  </span>;
}
