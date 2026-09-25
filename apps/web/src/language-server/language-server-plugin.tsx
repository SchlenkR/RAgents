import { Alert, AlertDescription, Badge, Button, Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner } from "../ui";
import { useEffect, useState, type ComponentType } from "react";
import type {
  LanguageServerInstanceSnapshot,
  LanguageServerSeverity,
  LanguageServerSnapshot,
  LanguageServerSolutions,
  LanguageServerState,
} from "@ragents/host/plugin-support/language-server/contract";
import { useAccess } from "../AccessContext";
import {
  type WebPlugin,
  type WebPluginDescriptor,
  type WorkspaceTabContext,
} from "../PluginRegistry";
import { fetchLanguageServerSnapshot, fetchLanguageServerSolutions, switchLanguageServerSolution } from "./api";

const POLL_MS = 5000;
const BADGE_POLL_MS = 15000;

interface TabSettings {
  label: string;
  openTool: string;
  pluginId: string;
  solutions: boolean;
}

export interface SolutionChoice {
  solutions?: LanguageServerSolutions;
  error?: string;
  switching: boolean;
  writable: boolean;
  onSwitch: (root: string | null) => void;
}

const NO_SOLUTION = "none";

const solutionValue = (path: string): string => `solution:${path}`;

const severityLabels: Readonly<Record<LanguageServerSeverity, string>> = {
  error: "Fehler",
  warning: "Warnung",
  information: "Hinweis",
  hint: "Tipp",
};

const textFrom = (config: Readonly<Record<string, unknown>>, key: string, pluginId: string): string => {
  const value = config[key];
  if (typeof value !== "string" || !value) throw new Error(`Plugin-Konfiguration für ${pluginId} enthält kein ${key}`);
  return value;
};

const stateLabel = (state: LanguageServerState): string => {
  if (state === "opening") return "wird geladen";
  if (state === "failed") return "fehlgeschlagen";
  if (state === "suspended") return "nach Leerlauf beendet";
  return "bereit";
};

const headerLabel = (snapshot: LanguageServerSnapshot | undefined): string => {
  if (!snapshot) return "wird geladen";
  const count = snapshot.instances.length;
  if (count === 0) return "nicht gestartet";
  return count === 1 ? "1 Instanz" : `${count} Instanzen`;
};

const countLabel = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

const messageOf = (caught: unknown): string => caught instanceof Error ? caught.message : String(caught);

/** Genau eine offene Instanz einer gefundenen Solution oder keine ergibt eine Auswahl; mehrere oder eine andere Wurzel nicht. */
const selectedSolution = (solutions: LanguageServerSolutions, snapshot: LanguageServerSnapshot): string | null => {
  const roots = snapshot.instances.map((instance) => instance.root);
  if (roots.length === 0) return NO_SOLUTION;
  if (roots.length > 1) return null;
  const open = solutions.solutions.find((solution) => solution.root === roots[0]);
  return open ? solutionValue(open.path) : null;
};

const errorsOf = (snapshot: LanguageServerSnapshot | undefined): number =>
  (snapshot?.instances ?? [])
    .filter((instance) => instance.state === "ready" || instance.state === "suspended")
    .flatMap((instance) => instance.files)
    .flatMap((file) => file.diagnostics)
    .filter((entry) => entry.severity === "error").length;

const compactEmpty = "h-auto min-h-30 flex-none";
const severityClass = "text-[0.64rem] uppercase tracking-[0.04em]"
  + " in-data-[severity=error]:text-destructive in-data-[severity=warning]:text-warning"
  + " in-data-[severity=information]:text-primary in-data-[severity=hint]:text-primary";

function IconDiagnostics() {
  return (
    <svg aria-hidden fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15">
      <path d="M9 4 4 12l5 8M15 4l5 8-5 8" />
      <path d="M12 9v4M12 16v.5" />
    </svg>
  );
}

function IconRefresh({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="15">
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6.1 9a7 7 0 0 1 11.7-2L20 9M4 15l2.2 2A7 7 0 0 0 18 15" />
    </svg>
  );
}

const useSnapshot = (pluginId: string, runId: string, active: boolean, pollMs: number = POLL_MS) => {
  const [snapshot, setSnapshot] = useState<LanguageServerSnapshot>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: number | undefined;

    const poll = async () => {
      setPending(true);
      try {
        const value = await fetchLanguageServerSnapshot(pluginId, runId);
        if (disposed) return;
        setSnapshot(value);
        setError(undefined);
      } catch (caught) {
        if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!disposed) {
          setPending(false);
          timer = window.setTimeout(() => void poll(), pollMs);
        }
      }
    };

    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, pluginId, pollMs, refreshKey, runId]);

  return { snapshot, error, pending, refresh: () => setRefreshKey((value) => value + 1) };
};

const useSolutions = (pluginId: string, runId: string, active: boolean, onSwitched: () => void) => {
  const [solutions, setSolutions] = useState<LanguageServerSolutions>();
  const [error, setError] = useState<string>();
  const [switching, setSwitching] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    fetchLanguageServerSolutions(pluginId, runId).then(
      (value) => {
        if (disposed) return;
        setSolutions(value);
        setError(undefined);
      },
      (caught: unknown) => {
        if (!disposed) setError(messageOf(caught));
      },
    );
    return () => { disposed = true; };
  }, [active, pluginId, refreshKey, runId]);

  const switchTo = (root: string | null) => {
    setSwitching(true);
    setError(undefined);
    switchLanguageServerSolution(pluginId, runId, root)
      .then(setSolutions, (caught: unknown) => setError(messageOf(caught)))
      .finally(() => {
        setSwitching(false);
        onSwitched();
      });
  };

  return { solutions, error, switching, switchTo, refresh: () => setRefreshKey((value) => value + 1) };
};

const panelFor = (settings: TabSettings) => {
  function LanguageServerPanel({ active, session }: WorkspaceTabContext) {
    const { snapshot, error, pending, refresh } = useSnapshot(settings.pluginId, session.session.id, active);
    const access = useAccess();
    const choice = useSolutions(settings.pluginId, session.session.id, active && settings.solutions, refresh);
    const refreshAll = () => {
      refresh();
      choice.refresh();
    };
    return (
      <LanguageServerPanelView
        settings={settings}
        snapshot={snapshot}
        error={error}
        pending={pending}
        onRefresh={settings.solutions ? refreshAll : refresh}
        choice={settings.solutions ? {
          solutions: choice.solutions,
          error: choice.error,
          switching: choice.switching,
          writable: access.can("runs.write") && access.can(`${settings.pluginId}.write`),
          onSwitch: choice.switchTo,
        } : undefined}
      />
    );
  }

  return LanguageServerPanel;
};

function SolutionSelect({ choice, snapshot }: { choice: SolutionChoice; snapshot: LanguageServerSnapshot | undefined }) {
  const { solutions } = choice;
  if (!solutions || !snapshot) return null;
  if (solutions.solutions.length === 0) {
    return <p className="border-t border-border-soft px-2.5 py-2 text-xs text-muted-foreground">Keine Solution im Arbeitsbereich.</p>;
  }
  const openRoots = new Set(snapshot.instances.map((instance) => instance.root));
  const items = [
    { value: NO_SOLUTION, path: null, label: "Keine" },
    ...solutions.solutions.map((solution) => ({
      value: solutionValue(solution.path),
      path: solution.path,
      label: openRoots.has(solution.root) ? `${solution.path} (offen)` : solution.path,
    })),
  ];
  const instances = snapshot.instances.length;

  return (
    <div className="flex items-center gap-2 border-t border-border-soft px-2.5 py-2">
      <span className="flex-none text-xs text-muted-foreground">Solution</span>
      <Select
        disabled={!choice.writable || choice.switching}
        items={items}
        onValueChange={(value) => {
          const item = items.find((entry) => entry.value === value);
          if (item) choice.onSwitch(item.path);
        }}
        value={selectedSolution(solutions, snapshot)}
      >
        <SelectTrigger aria-label="Solution wählen" className="min-w-0 flex-1" size="sm" title={choice.writable ? undefined : "Umschalten verlangt Schreibrechte"}>
          <SelectValue placeholder={instances > 1 ? `${instances} Instanzen offen` : "Andere Wurzel offen"} />
        </SelectTrigger>
        <SelectContent>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
      </Select>
      {choice.switching && <Spinner aria-label="Wird umgeschaltet" />}
    </div>
  );
}

function LanguageServerInstanceView({ instance }: { instance: LanguageServerInstanceSnapshot }) {
  const diagnosticsAvailable = instance.state === "ready" || instance.state === "suspended";
  const files = diagnosticsAvailable ? instance.files : [];
  const rows = files.flatMap((file) => file.diagnostics.map((entry) => ({ file: file.path, entry })));
  const errors = rows.filter((row) => row.entry.severity === "error").length;
  const warnings = rows.filter((row) => row.entry.severity === "warning").length;

  return (
    <section className="border-b border-border-soft last:border-b-0">
      <div className="flex items-baseline gap-2 px-2.5 pt-2 pb-1">
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.66rem] text-muted-foreground" title={instance.root}>{instance.root}</span>
        <span className="flex-none text-[0.64rem] uppercase tracking-[0.04em] text-muted-foreground">{stateLabel(instance.state)}</span>
      </div>
      {instance.state === "opening" && (
        <Empty className={compactEmpty} role="status">
          <EmptyHeader>
            <EmptyMedia><Spinner aria-label="Wird geladen" /></EmptyMedia>
            <EmptyTitle>Sprachserver wird geladen</EmptyTitle>
            <EmptyDescription>{instance.summary || "Die Initialisierung läuft."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {instance.state === "failed" && (
        <Empty className={`${compactEmpty} text-destructive`} role="alert">
          <EmptyHeader>
            <EmptyTitle>Sprachserver nicht verfügbar</EmptyTitle>
            <EmptyDescription className="whitespace-pre-wrap text-destructive [overflow-wrap:anywhere]">{instance.summary || "Beim Laden ist ein Fehler aufgetreten."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {diagnosticsAvailable && rows.length === 0 && (
        <Empty className={compactEmpty}>
          <EmptyHeader>
            <EmptyTitle>Keine Diagnosen</EmptyTitle>
            <EmptyDescription>{files.length === 0 ? "Bisher wurde keine Datei geprüft." : "Alle geprüften Dateien sind fehlerfrei."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {rows.length > 0 && (
        <>
          <div className="border-y border-border-soft px-2.5 py-1.5 text-xs text-muted-foreground">
            {`${countLabel(errors, "Fehler", "Fehler")}, ${countLabel(warnings, "Warnung", "Warnungen")} in ${countLabel(files.length, "Datei", "Dateien")}`}
          </div>
          <div className="px-1.5 pt-1 pb-2.5">
            {rows.map((row, index) => (
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 border-b border-border-soft px-2 py-1.5 text-[0.7rem]"
                data-severity={row.entry.severity} key={`${row.file}:${row.entry.line}:${row.entry.character}:${index}`}>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-muted-foreground">{`${row.file}:${row.entry.line}`}</span>
                <span className={severityClass}>
                  {row.entry.code ? `${severityLabels[row.entry.severity]} ${row.entry.code}` : severityLabels[row.entry.severity]}
                </span>
                <span className="col-span-full leading-[1.4] text-foreground">{row.entry.message}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function LanguageServerPanelView({ settings, snapshot, error, pending, onRefresh, choice }: {
  settings: Pick<TabSettings, "label" | "openTool">;
  snapshot?: LanguageServerSnapshot;
  error?: string;
  pending: boolean;
  onRefresh: () => void;
  choice?: SolutionChoice;
}) {
  const instances = snapshot?.instances ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 px-2.5 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[0.8rem] font-medium text-foreground">{settings.label}</span>
          <span className="text-xs text-muted-foreground">{headerLabel(snapshot)}</span>
        </div>
        <Button aria-label="Diagnosen aktualisieren" onClick={onRefresh} size="icon" title="Aktualisieren" variant="ghost">
          <IconRefresh className={pending ? "animate-spin" : undefined} />
        </Button>
      </header>
      {choice && <SolutionSelect choice={choice} snapshot={snapshot} />}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {choice?.error && <Alert variant="destructive"><AlertDescription>{choice.error}</AlertDescription></Alert>}
      {snapshot && instances.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia><IconDiagnostics /></EmptyMedia>
            <EmptyTitle>Kein Sprachserver</EmptyTitle>
            <EmptyDescription>{`${settings.label}-Sprachserver ist nicht gestartet - ein Agent startet ihn mit ${settings.openTool}.`}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {instances.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-soft">
          {instances.map((instance) => <LanguageServerInstanceView instance={instance} key={instance.root} />)}
        </div>
      )}
    </div>
  );
}

const badgeFor = (settings: TabSettings) => {
  function LanguageServerBadge({ session }: WorkspaceTabContext) {
    const { snapshot } = useSnapshot(settings.pluginId, session.session.id, true, BADGE_POLL_MS);
    const errors = errorsOf(snapshot);
    return errors > 0 ? <Badge variant="secondary">{errors}</Badge> : null;
  }

  return LanguageServerBadge;
};

const configuredPlugin = (descriptor: WebPluginDescriptor, settings: TabSettings, Icon: ComponentType): WebPlugin => ({
  ...descriptor,
  workspaceTabs: [{
    readRight: `${descriptor.id}.read`,
    requiresWorkspace: true,
    id: `${descriptor.id}.diagnostics`,
    label: settings.label,
    order: 300,
    Icon,
    Panel: panelFor(settings),
    Badge: badgeFor(settings),
  }],
});

export const languageServerWebPlugin = (pluginId: string, Icon: ComponentType = IconDiagnostics): WebPlugin => {
  const descriptor: WebPluginDescriptor = { id: pluginId };
  return {
    ...descriptor,
    activate: (config) => configuredPlugin(descriptor, {
      label: textFrom(config, "label", pluginId),
      openTool: textFrom(config, "openTool", pluginId),
      pluginId,
      solutions: config.solutions === true,
    }, Icon),
  };
};
