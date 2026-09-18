import { useCallback, useEffect, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, LayoutGridIcon } from "lucide-react";
import { canStartEntry } from "../../../../packages/ragents/src/access";
import { AccessScreen, useAccess } from "../AccessContext";
import type { SessionInfo } from "../api";
import { PluginChat } from "../PluginChat";
import type { PluginRegistry } from "../PluginRegistry";
import { usePluginActivation } from "../PluginActivation";
import { useRunReadState } from "../run-read-state";
import { SessionList } from "../SessionList";
import { SettingsModal } from "../SettingsModal";
import { Alert, Button } from "../ui";
import type { ColumnLocation } from "./column-location";
import { ColumnMenu } from "./ColumnMenu";
import { useColumnHost } from "./host";
import { useSessionList } from "./use-session-list";

const headerClass = "relative z-[80] flex h-header flex-none items-stretch border-b border-border bg-shell shadow-bar";
const listHeaderClass = "relative z-[80] flex h-header flex-none items-center gap-2 border-b border-border bg-shell px-3 shadow-bar";
const noticeClass = "m-auto max-w-[420px] p-6 text-center text-muted-foreground";
const noSelection: ReadonlySet<string> = new Set();
const newDraft = (): SessionInfo => ({ id: crypto.randomUUID(), title: "Neuer Run", updatedAt: Date.now() });
const placeholderSession = (id: string): SessionInfo => ({ id, title: "Run", updatedAt: Date.now() });

/** Die Arbeitsspalte: ein Run mit Chat und Mini-Apps, ohne Run die Run-Liste; layout=app zeigt genau ein Canvas-Element. */
export function ColumnApp({ location }: { location: ColumnLocation }) {
  const activation = usePluginActivation();
  if (activation.status === "loading") return <div className={noticeClass}>Produktprofil wird geladen.</div>;
  if (activation.status === "failed") return (
    <Alert className="m-auto max-w-[420px] gap-3 p-6" variant="destructive">
      <p>{activation.error}</p>
      <Button onClick={() => window.location.reload()} variant="outline">Neu laden</Button>
    </Alert>
  );
  return location.layout === "app"
    ? <ElementPage elementId={location.elementId} registry={activation.registry} runId={location.runId} />
    : <ColumnPage initialRunId={location.runId} registry={activation.registry} />;
}

function ColumnPage({ initialRunId, registry }: { initialRunId: string | undefined; registry: PluginRegistry }) {
  const host = useColumnHost();
  const access = useAccess();
  const readRuns = access.can("runs.read");
  const writeRuns = readRuns && access.can("runs.write");
  const canCreate = writeRuns && (access.can("runs.create") || registry.scriptEntries.some((entry) => canStartEntry(access, entry.id)));
  const runReadState = useRunReadState(access.user?.id);
  const [runId, setRunId] = useState(initialRunId);
  const [draft, setDraft] = useState<SessionInfo>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const { sessions, unreachable, refresh } = useSessionList(readRuns && !draft);
  const [headerContainer, setHeaderContainer] = useState<HTMLDivElement | null>(null);
  const [toolsContainer, setToolsContainer] = useState<HTMLDivElement | null>(null);
  const startDraft = useCallback(() => { setListOpen(false); setDraft(newDraft()); }, []);
  const selectRun = useCallback((id: string) => { setListOpen(false); setRunId(id); }, []);

  useEffect(() => host.onCommand((message) => {
    if (message.type === "selectRun") {
      setDraft(undefined);
      setListOpen(false);
      setRunId(message.runId ?? undefined);
    }
    if (message.type === "newRun" && canCreate) startDraft();
  }), [canCreate, host, startDraft]);
  useEffect(() => { host.notify({ type: "ready" }); }, [host]);
  useEffect(() => { host.notify({ type: "runChanged", runId: runId ?? null }); }, [host, runId]);
  useEffect(() => {
    if (!listOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setListOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [listOpen]);

  const session = sessions.find((entry) => entry.id === runId);
  const list = readRuns
    ? <SessionList activeId={runId} onCreate={canCreate ? startDraft : undefined} onSelect={selectRun} onToggleSelected={() => undefined} registry={registry} seenRevisions={runReadState.revisions} selectMode={false} selectedIds={noSelection} sessions={sessions} />
    : <p className={noticeClass}>Für dieses Benutzerkonto sind keine Runs freigegeben.</p>;
  return (
    <div className="flex h-full flex-col bg-[image:var(--canvas-backdrop)]">
      {readRuns && runId
        ? (
          <>
            <header className={headerClass}>
              <Button aria-expanded={listOpen} aria-label={listOpen ? "Run-Liste schließen" : "Run-Liste aufklappen"} className="self-center" onClick={() => setListOpen((value) => !value)} size="icon-lg" title={listOpen ? "Run-Liste schließen (Escape)" : "Run-Liste aufklappen"} variant="ghost">{listOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}</Button>
              <div aria-label="Run-Titelleiste" className="flex min-w-0 flex-1 items-stretch overflow-x-auto no-scrollbar" ref={setHeaderContainer} role="region" />
              <div aria-label="Werkzeuge der Spalte" className="flex flex-none items-center empty:hidden" ref={setToolsContainer} role="toolbar" />
              <ColumnMenu onOpenSettings={openSettings} />
            </header>
            <main className="relative z-1 flex min-h-0 min-w-0 flex-1 @container/chat-content">
              <PluginChat
                canvasToolbarContainer={toolsContainer}
                headerContainer={headerContainer}
                key={runId}
                layout="column"
                onViewed={runReadState.markViewed}
                registry={registry}
                session={session ?? placeholderSession(runId)}
                viewing={!draft && !settingsOpen && !listOpen}
              />
              {listOpen && <div aria-label="Run-Liste" className="absolute inset-0 z-[70] overflow-auto bg-background p-3" role="dialog">
                {unreachable && <Alert className="mb-3" variant="destructive">Der Server ist nicht erreichbar.</Alert>}
                {list}
              </div>}
            </main>
          </>
        )
        : (
          <>
            <header className={listHeaderClass}>
              <LayoutGridIcon aria-hidden className="size-4 flex-none text-muted-foreground" />
              <strong className="min-w-0 flex-1 truncate text-[0.82rem] font-semibold">{registry.brand.title}</strong>
              <ColumnMenu onOpenSettings={openSettings} />
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {unreachable && <Alert className="mb-3" variant="destructive">Der Server ist nicht erreichbar.</Alert>}
              {list}
            </div>
          </>
        )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} registry={registry} />}
      {draft && (
        <PluginChat
          key={draft.id}
          onStarted={() => { setRunId(draft.id); setDraft(undefined); void refresh(); }}
          registry={registry}
          session={draft}
          startDialog={{ onClose: () => setDraft(undefined) }}
        />
      )}
    </div>
  );
}

function ElementPage({ elementId, registry, runId }: { elementId: string; registry: PluginRegistry; runId: string }) {
  const host = useColumnHost();
  const readRuns = useAccess().can("runs.read");
  const { sessions } = useSessionList(readRuns);
  useEffect(() => { host.notify({ type: "ready" }); }, [host]);
  if (!readRuns) return <p className={noticeClass}>Für dieses Benutzerkonto sind keine Runs freigegeben.</p>;
  return (
    <main className="relative flex h-full min-h-0 min-w-0 flex-1 bg-background @container/chat-content">
      <PluginChat key={runId} layout={{ element: elementId }} registry={registry} session={sessions.find((entry) => entry.id === runId) ?? placeholderSession(runId)} />
    </main>
  );
}

/** Im VS-Code-Webview führt die Erweiterung die Anmeldung; die Spalte bittet nur darum. */
export function HostLogin() {
  const host = useColumnHost();
  return <AccessScreen>
    <h1 className="my-3 text-[1.5rem]">Anmeldung erforderlich</h1>
    <p className="mb-6 leading-normal text-muted-foreground">Die Anmeldung läuft über VS Code. Danach lädt die Spalte neu.</p>
    <Button className="w-full" onClick={() => host.requestLogin()}>In VS Code anmelden</Button>
  </AccessScreen>;
}
