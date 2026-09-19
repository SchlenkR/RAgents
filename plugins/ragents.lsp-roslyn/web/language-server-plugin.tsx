import { Alert, AlertDescription, Badge, Button, Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle, Spinner } from "@aicontainer/web/ui";
import { useEffect, useState, type ComponentType } from "react";
import type {
  LanguageServerSeverity,
  LanguageServerSnapshot,
} from "@aicontainer/server/plugin-support/language-server/contract";
import {
  type WebPlugin,
  type WebPluginDescriptor,
  type WorkspaceTabContext,
} from "@aicontainer/web/PluginRegistry";
import { fetchLanguageServerSnapshot } from "./api";

const POLL_MS = 5000;
const BADGE_POLL_MS = 15000;

interface TabSettings {
  label: string;
  openTool: string;
  pluginId: string;
}

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

const stateLabel = (snapshot: LanguageServerSnapshot | undefined): string => {
  if (!snapshot) return "wird geladen";
  if (snapshot.state === "closed") return "nicht gestartet";
  if (snapshot.state === "opening") return "wird geladen";
  if (snapshot.state === "failed") return "fehlgeschlagen";
  if (snapshot.state === "suspended") return "nach Leerlauf beendet";
  return snapshot.summary ?? "bereit";
};

const countLabel = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

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

const panelFor = (settings: TabSettings) => {
  function LanguageServerPanel({ active, session }: WorkspaceTabContext) {
    const { snapshot, error, pending, refresh } = useSnapshot(settings.pluginId, session.session.id, active);
    return <LanguageServerPanelView settings={settings} snapshot={snapshot} error={error} pending={pending} onRefresh={refresh} />;
  }

  return LanguageServerPanel;
};

export function LanguageServerPanelView({ settings, snapshot, error, pending, onRefresh }: {
  settings: Pick<TabSettings, "label" | "openTool">;
  snapshot?: LanguageServerSnapshot;
  error?: string;
  pending: boolean;
  onRefresh: () => void;
}) {
  const diagnosticsAvailable = snapshot?.state === "ready" || snapshot?.state === "suspended";
  const files = diagnosticsAvailable ? snapshot.files : [];
  const rows = files.flatMap((file) => file.diagnostics.map((entry) => ({ file: file.path, entry })));
  const errors = rows.filter((row) => row.entry.severity === "error").length;
  const warnings = rows.filter((row) => row.entry.severity === "warning").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 px-2.5 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[0.8rem] font-medium text-foreground">{settings.label}</span>
          <span className="text-xs text-muted-foreground">{stateLabel(snapshot)}</span>
        </div>
        <Button aria-label="Diagnosen aktualisieren" onClick={onRefresh} size="icon" title="Aktualisieren" variant="ghost">
          <IconRefresh className={pending ? "animate-spin" : undefined} />
        </Button>
      </header>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {snapshot?.root && <div className="overflow-hidden text-ellipsis whitespace-nowrap px-2.5 pb-2 font-mono text-[0.66rem] text-muted-foreground" title={snapshot.root}>{snapshot.root}</div>}
      {snapshot?.state === "opening" && (
        <Empty className={compactEmpty} role="status">
          <EmptyHeader>
            <EmptyMedia><Spinner aria-label="Wird geladen" /></EmptyMedia>
            <EmptyTitle>Sprachserver wird geladen</EmptyTitle>
            <EmptyDescription>{snapshot.summary || "Die Initialisierung läuft."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {snapshot?.state === "failed" && (
        <Empty className={`${compactEmpty} text-destructive`} role="alert">
          <EmptyHeader>
            <EmptyTitle>Sprachserver nicht verfügbar</EmptyTitle>
            <EmptyDescription className="whitespace-pre-wrap text-destructive [overflow-wrap:anywhere]">{snapshot.summary || "Beim Laden ist ein Fehler aufgetreten."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {snapshot?.state === "closed" && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia><IconDiagnostics /></EmptyMedia>
            <EmptyTitle>Kein Sprachserver</EmptyTitle>
            <EmptyDescription>{`${settings.label}-Sprachserver ist nicht gestartet - ein Agent startet ihn mit ${settings.openTool}.`}</EmptyDescription>
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
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pt-1 pb-2.5">
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
    </div>
  );
}

const badgeFor = (settings: TabSettings) => {
  function LanguageServerBadge({ session }: WorkspaceTabContext) {
    const { snapshot } = useSnapshot(settings.pluginId, session.session.id, true, BADGE_POLL_MS);
    const errors = (snapshot?.state === "ready" || snapshot?.state === "suspended" ? snapshot.files : [])
      .flatMap((file) => file.diagnostics)
      .filter((entry) => entry.severity === "error").length;
    return errors > 0 ? <Badge variant="secondary">{errors}</Badge> : null;
  }

  return LanguageServerBadge;
};

const configuredPlugin = (descriptor: WebPluginDescriptor, settings: TabSettings, Icon: ComponentType): WebPlugin => ({
  ...descriptor,
  workspaceTabs: [{
    readRight: `${descriptor.id}.read`,
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
    }, Icon),
  };
};
