import { useId } from "react";
import { DetailRow, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ragents/web/ui";
import type { StartOptionBadgeContext, StartOptionControlContext } from "@ragents/web/PluginRegistry";

interface AccessPresentation {
  readonly machine: "server" | "workstation";
  readonly commandIsolation: "isolated" | "unsupported" | "unknown";
  readonly fullAccessDisabledReason: string | null;
}

export const accessPresentationFrom = (value: unknown): AccessPresentation => {
  const raw = value as Record<string, unknown> | null;
  if (typeof raw !== "object" || raw === null || raw.kind !== "workspace-access"
    || (raw.machine !== "server" && raw.machine !== "workstation")
    || (raw.commandIsolation !== "isolated" && raw.commandIsolation !== "unsupported" && raw.commandIsolation !== "unknown")
    || (raw.fullAccessDisabledReason !== null && typeof raw.fullAccessDisabledReason !== "string")) {
    throw new Error("The workspace access option does not provide an access presentation.");
  }
  return { machine: raw.machine, commandIsolation: raw.commandIsolation, fullAccessDisabledReason: raw.fullAccessDisabledReason };
};

const accessFrom = (value: unknown): "isolated" | "full" => {
  if (value !== "isolated" && value !== "full") throw new Error("The workspace access level must be isolated or full.");
  return value;
};

const parse = (option: StartOptionControlContext["option"]) => {
  try {
    return { level: accessFrom(option.value), presentation: accessPresentationFrom(option.presentation) };
  } catch (cause) {
    return { message: cause instanceof Error ? cause.message : String(cause) };
  }
};

function Shield() {
  return <svg aria-hidden fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="14">
    <path d="M12 3 4.5 6v5.5c0 4 3 7.3 7.5 9.5 4.5-2.2 7.5-5.5 7.5-9.5V6z" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </svg>;
}

export function AccessControl({ option, disabled, error, setValue }: StartOptionControlContext) {
  const reasonId = useId();
  const isolationId = useId();
  const parsed = parse(option);
  if ("message" in parsed) return <span className="text-xs text-destructive" role="alert">{parsed.message}</span>;
  const { level, presentation } = parsed;
  const reason = presentation.fullAccessDisabledReason;
  const isolation = level === "isolated" && presentation.machine === "workstation" && presentation.commandIsolation !== "isolated"
    ? presentation.commandIsolation === "unsupported" ? "Commands are not isolated on this machine." : "Command isolation is unknown until the workstation reconnects." : undefined;
  const items = [{ value: "isolated", label: "Isolated" }, { value: "full", label: "Full access", disabled: reason !== null }];
  return <div className="flex min-w-0 flex-col gap-1" data-access-level={level}>
    <Select disabled={disabled || (level === "isolated" && reason !== null)} items={items} value={level}
      onValueChange={(next) => { if (next === "isolated" || (next === "full" && reason === null)) void setValue(next); }}>
      <SelectTrigger aria-describedby={[reason ? reasonId : undefined, isolation ? isolationId : undefined].filter(Boolean).join(" ") || undefined} aria-label="Run access" size="sm"
        className={`min-w-0 max-w-full border-transparent bg-transparent px-2 font-medium dark:bg-transparent ${level === "full" ? "text-warning hover:text-warning open:text-warning" : "text-muted-foreground"}`}>
        <Shield /><SelectValue />
      </SelectTrigger>
      <SelectContent align="end" side="top">
        {items.map((item) => <SelectItem disabled={item.disabled} key={item.value} value={item.value}>{item.label}</SelectItem>)}
      </SelectContent>
    </Select>
    {reason && <span className="max-w-64 text-xs text-muted-foreground" id={reasonId}>{reason}</span>}
    {isolation && <span className="max-w-64 text-xs text-muted-foreground" id={isolationId}>{isolation}</span>}
    {error && <span className="text-xs text-destructive" role="alert">{error}</span>}
  </div>;
}

export const accessExplanation = (
  level: "isolated" | "full",
  machine: AccessPresentation["machine"],
  commandIsolation: AccessPresentation["commandIsolation"] = machine === "server" ? "isolated" : "unknown",
): string => {
  if (level === "full") return machine === "server"
    ? "File tools accept every path and commands run without the process sandbox. The server environment keeps its safe allowlist."
    : "File tools accept every path and commands inherit the workstation environment, including secrets. Local confirmation is required.";
  const files = "Reads follow the machine's blocked and allowed areas; writes stay in the run's writable folders and write grants.";
  if (machine === "server") return `${files} Commands use the process sandbox and the server environment keeps its safe allowlist.`;
  const commands = commandIsolation === "isolated" ? "Commands are isolated by the workstation OS sandbox."
    : commandIsolation === "unsupported" ? "Commands are not isolated on this machine; the file rule applies to file tools only."
      : "Command isolation is unknown until the workstation reconnects.";
  return `${files} Secrets are removed from the environment. ${commands} Network access is unrestricted.`;
};

export function AccessBadge({ option }: StartOptionBadgeContext) {
  const parsed = parse(option);
  if ("message" in parsed) return <DetailRow label="Access"><span className="text-destructive" role="alert">{parsed.message}</span></DetailRow>;
  const { level, presentation } = parsed;
  return <DetailRow explanation={accessExplanation(level, presentation.machine, presentation.commandIsolation)} label="Access">
    <span className={level === "full" ? "text-warning" : undefined} data-access-level={level}>{level === "full" ? "Full access" : "Isolated"}</span>
  </DetailRow>;
}
