import {
  CircleAlertIcon, CircleCheckIcon, CircleEllipsisIcon, CircleIcon, CirclePlayIcon, CircleSlashIcon, CircleXIcon, HourglassIcon, LockIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "cn";
import { connectionStateWord, runStateWord, type ConnectionStateName, type RunStateName } from "./state-vocabulary";

interface Mark {
  readonly Icon: ComponentType<{ className?: string; fill?: string }>;
  readonly tone: string;
  readonly filled?: boolean;
}

/** Grün läuft, blau bewegt sich, gelb wartet auf dich, rot ist kaputt, grau ruht, gedämpft ist vorbei; kein Zustand trägt je die Stopp-Glyphe (Quadrat). */
const RUN_MARKS: Record<RunStateName, Mark> = {
  running: { Icon: CirclePlayIcon, tone: "text-success" },
  waiting: { Icon: CircleEllipsisIcon, tone: "text-warning" },
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

export function RunStateIcon({ state, open = 0, className }: { state: RunStateName; open?: number; className?: string }) {
  const mark = RUN_MARKS[state];
  const word = runStateWord(state, open);
  const Icon = mark.Icon;
  return <span className={cn(markClass, mark.tone, className)} title={word}>
    <Icon className="size-3.5" />
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
