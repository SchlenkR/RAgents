import { runApps, selectedRunApp, RunAppView } from "@ragents/web/run-apps";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowUpRightIcon, LayoutGridIcon, SearchIcon } from "lucide-react";
import { useAccess } from "@ragents/web/AccessContext";
import { ChatPanel } from "quassel";
import { useRunPanelHost } from "@ragents/web/run-panel/host";
import { useSurfaceController, type SurfaceCenterContext, type CardSectionContribution, type SessionContext, type SessionNavigation } from "@ragents/web/PluginRegistry";
import { INSPECTION_TAB_ID } from "../InspectionPanel";
import { Button, StartupNotice } from "@ragents/web/ui";
import { ActorChat } from "../ActorChat";
import { ActorChatControls } from "../ActorChatControls";
import { surfaceStartupState, type SurfaceStartupState } from "../surface-startup";
import { cardSectionsClass } from "../constants";
import type { FlowSelection } from "../FlowInspector";
import { chatPrimaryId, runViewFrom, type RunActor, type RunView } from "@ragents/web/run-view";
import { AddresseeControl } from "./AddresseeControl";
import { runPanelActors } from "./run-panel-actors";
import { chatShowsContent, useRunPanelStartup } from "./run-panel-startup";
import { saveRunPanelState, useRunPanelState, type RunPanelState } from "./run-panel-state";

const chipClass = "flex h-7 max-w-[200px] flex-none cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-2 text-[0.72rem] font-semibold text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring/60 aria-selected:border-primary aria-selected:bg-primary/10";
const viewClass = "relative flex min-h-0 min-w-0 flex-1 flex-col";
const chatSurfaceClass = "rounded-none border-0 bg-transparent";

export function OrchestrationRunPanel(props: SurfaceCenterContext) {
  return <RunPanel key={props.session.session.id} {...props} />;
}

function RunPanel({ surfaceElements, cardSections, navigation, renderChat, session }: SurfaceCenterContext) {
  const runId = session.session.id;
  const surface = useSurfaceController();
  const inspect = useAccess().can("runs.inspect");
  const host = useRunPanelHost();
  const view = runViewFrom(session.runView);
  const stored = useRunPanelState(runId);
  const save = useCallback((patch: Partial<RunPanelState>) => saveRunPanelState(runId, { ...stored, ...patch }), [runId, stored]);
  const elements = useMemo(() => runApps(session, surfaceElements), [surfaceElements, session]);
  const selectedElement = host.kind === "browser" ? selectedRunApp(elements, stored.element) : undefined;
  useEffect(() => {
    if (host.kind === "browser" && session.connected && stored.element !== null && !selectedElement) save({ element: null });
  }, [host.kind, save, selectedElement, session.connected, stored.element]);
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set(stored.element ? [stored.element] : []));
  const selectedId = selectedElement?.definition.id;
  useEffect(() => {
    if (selectedId) setVisited((current) => current.has(selectedId) ? current : new Set([...current, selectedId]));
  }, [selectedId]);
  const startup = useRunPanelStartup(
    surfaceStartupState({ view, startup: session.startup, connected: session.connected, running: session.running, error: session.conversationError }),
    session.connected,
    elements.length > 0 || chatShowsContent(session.messages),
  );
  const notice = startup ? <RunPanelStartup state={startup} /> : undefined;
  const actors = useMemo(() => view ? runPanelActors(view, inspect) : [], [inspect, view]);
  const primaryId = view ? chatPrimaryId(view) : undefined;
  const selectedActor = actors.find((actor) => actor.id === stored.actor) ?? actors.find((actor) => actor.id === primaryId) ?? actors[0];
  const [visitedActors, setVisitedActors] = useState<ReadonlySet<string>>(() => new Set(stored.actor ? [stored.actor] : []));
  const selectActor = useCallback((actor: RunActor) => {
    setVisitedActors((current) => new Set([...current, actor.id]));
    save({ actor: actor.id });
  }, [save]);
  const navigate = useCallback((selection: FlowSelection) => {
    const actor = selection.type === "actor" ? actors.find((entry) => entry.id === selection.id) : undefined;
    if (actor) selectActor(actor);
    else if (inspect) navigation.openTab(INSPECTION_TAB_ID, selection);
  }, [actors, inspect, navigation, selectActor]);
  const primarySelected = selectedActor === undefined || selectedActor.id === primaryId;
  useEffect(() => {
    const selection = selectedElement ? { type: "run-app", id: selectedElement.definition.id }
      : selectedActor ? { type: "actor", id: selectedActor.id } : undefined;
    if (surface?.selection?.type !== selection?.type || surface?.selection?.id !== selection?.id) surface?.acceptSelection(selection);
  }, [selectedActor, selectedElement, surface]);
  const addressee = view && selectedActor && <><AddresseeControl
    actors={actors}
    onSelect={selectActor}
    selected={selectedActor}
    technical={inspect}
    view={view}
  />{inspect && <Button aria-label={`Inspect @${selectedActor.handle}`} onClick={() => navigation.openTab(INSPECTION_TAB_ID, { type: "actor", id: selectedActor.id })} size="icon-sm" title="Inspect actor" variant="ghost"><SearchIcon /></Button>}</>;

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-app" data-run-panel="run">
    {elements.length > 0 && <nav aria-label="Mini-apps of the run" className="flex flex-none flex-wrap items-center gap-1.5 border-b border-border bg-shell px-2 py-1.5" role={host.kind === "browser" ? "tablist" : undefined}>
      {host.kind === "browser" && <button aria-selected={!selectedElement} className={chipClass} onClick={() => save({ element: null })} role="tab" type="button">Chat</button>}
      {elements.map(({ definition }) => <button
        aria-selected={host.kind === "browser" ? definition.id === selectedElement?.definition.id : undefined}
        className={chipClass}
        key={definition.id}
        onClick={() => {
          if (host.kind === "vscode") host.openApp(runId, definition.id, definition.title ?? definition.id);
          else {
            setVisited((current) => new Set([...current, definition.id]));
            save({ element: definition.id });
          }
        }}
        role={host.kind === "browser" ? "tab" : undefined}
        type="button"
      >
        <LayoutGridIcon aria-hidden className="size-3" />
        <span className="truncate">{definition.title ?? definition.id}</span>
        {host.kind === "vscode" && <ArrowUpRightIcon aria-hidden className="size-3" />}
      </button>)}
    </nav>}
    <section aria-label="Chat" className={viewClass} data-view={primarySelected ? "chat" : "actor-chat"} hidden={selectedElement !== undefined} inert={selectedElement !== undefined} style={selectedElement ? { display: "none" } : undefined}>
      <div className={viewClass} hidden={!primarySelected} inert={!primarySelected} style={primarySelected ? undefined : { display: "none" }}>
        {renderChat({ chatElementClassName: chatSurfaceClass, notice, toolbarLeft: addressee })}
      </div>
      {view && actors.filter((actor) => actor.id !== primaryId && (visitedActors.has(actor.id) || actor.id === selectedActor?.id)).map((actor) => {
        const selected = actor.id === selectedActor?.id;
        return <div className={viewClass} hidden={!selected} inert={!selected} key={actor.id} style={selected ? undefined : { display: "none" }}>
          <ActorRunPanelChat actor={actor} cardSections={cardSections} navigation={navigation} notice={notice} onNavigate={navigate} session={session} toolbarLeft={addressee} view={view} />
        </div>;
      })}
    </section>
    {host.kind === "browser" && elements.filter(({ definition }) => visited.has(definition.id) || definition.id === selectedElement?.definition.id).map((element) => {
      const selected = element === selectedElement;
      return <section aria-label={`Mini-app ${element.definition.title ?? element.definition.id}`} className={viewClass} hidden={!selected} inert={!selected} key={element.definition.id} role="tabpanel" style={selected ? undefined : { display: "none" }}>
        <RunAppView app={element} navigation={navigation} session={session} />
      </section>;
    })}
  </div>;
}

export function ActorRunPanelChat({ actor, cardSections, navigation, notice, onNavigate, session, toolbarLeft, view }: {
  actor: RunActor;
  cardSections: readonly CardSectionContribution[];
  navigation: SessionNavigation;
  notice?: ReactNode;
  onNavigate: (selection: FlowSelection) => void;
  session: SessionContext;
  toolbarLeft?: ReactNode;
  view: RunView;
}) {
  const running = actor.lifecycle?.kind === "running";
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <div className={`${cardSectionsClass} max-h-[40%] flex-none overflow-auto overscroll-contain border-t-0 border-b`} data-slot="card-sections">
      {cardSections.map(({ id, Section }) => <Section actor={actor} key={id} navigation={navigation} session={session} />)}
    </div>
    <ChatPanel className="flex-1" composer={<ActorChatControls actor={actor} presentation="panel" running={running} display="panel" toolbarLeft={toolbarLeft} view={view} />}>
      {notice ?? <ActorChat actor={actor} conversation={session.actorConversations?.[actor.id]} historyError={session.conversationError} onNavigate={onNavigate}
        presentation="inspector" primaryMessages={session.messages} running={running} display="panel" view={view} />}
    </ChatPanel>
  </div>;
}

/** The loading state centered in the chat; it only moves up where it would otherwise end up under the input. */
function RunPanelStartup({ state }: { state: SurfaceStartupState }) {
  return <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto_minmax(var(--qsl-composer-height,0px),1fr)] justify-items-center overflow-hidden p-6">
    <StartupNotice className="row-start-2" state={state} />
  </div>;
}
