import { useAccess } from "@ragents/web/AccessContext";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CanvasTiles } from "./CanvasTiles";
import type { CanvasTileNode } from "../tiled-layout";
import { CanvasStartup } from "./CanvasStartup";
import { canvasStartupState } from "./canvas-startup";
import { tileEntities } from "./tile-docking";
import { publishStageEntities } from "./canvas-stage";
import { initialTileLayout, saveCanvasPresentation, useCanvasPresentation } from "./tiled-view-settings";
import { StatusGroup } from "@ragents/web/StatusGroup";
import { statusControlClass } from "./constants";
import { runViewFrom } from "@ragents/web/run-view";
import { ActorCanvasControls, ActorHeaderModeControl } from "./ActorCanvasControls";
import { actorVisibleOnCanvas, saveCanvasViewPreferences, useCanvasViewPreferences } from "./canvas-view-settings";
import { useCanvasController, type CanvasCenterContext, type EntityReference } from "@ragents/web/PluginRegistry";

export function OrchestrationCenter(props: CanvasCenterContext) {
  return <RunOrchestrationCenter key={props.session.session.id} {...props} />;
}

function RunOrchestrationCenter({
  cardSections,
  canvasElements,
  navigation,
  session,
  statusContainer,
  runToolbarContainer,
}: CanvasCenterContext) {
  const inspect = useAccess().can("runs.inspect");
  const canvas = useCanvasController();
  if (!canvas) throw new Error("Die Kachelfläche braucht den Canvas-Controller des Orchestrierungs-Plugins.");
  const lastRunView = useRef<ReturnType<typeof runViewFrom>>(undefined);
  const parsedRunView = runViewFrom(session.runView);
  if (parsedRunView !== undefined) lastRunView.current = parsedRunView;
  const runView = parsedRunView ?? lastRunView.current;
  const { programLayout, personalLayout, presentation, programBasis } = useCanvasPresentation(session.session.id, runView);
  const [presentationError, setPresentationError] = useState<string>();
  const preferences = useCanvasViewPreferences(session.session.id);
  const appActorIds = useMemo(() => new Set(canvasElements.flatMap((contribution) => contribution.select(session)
    .flatMap((element) => element.anchorActorId ? [element.anchorActorId] : []))), [canvasElements, session]);
  const hiddenActorIds = useMemo(() => runView?.actors
    .filter((actor) => actor.kind !== "human" && (inspect ? !actorVisibleOnCanvas(actor, appActorIds, preferences, runView.primaryActorId) : actor.kind === "script")).map((actor) => actor.id) ?? [],
  [inspect, runView, appActorIds, preferences]);
  const visibleApps = useMemo(() => canvasElements.flatMap((contribution) => contribution.select(session)
    .filter((element) => element.visible !== false).map((element) => `app:${element.id}`)), [canvasElements, session]);
  const visibleEntities = new Set([
    ...visibleApps,
    ...(runView?.actors.filter((actor) => actor.kind !== "human" && actor.lifecycle?.kind !== "stopped"
      && (inspect || actor.kind === "agent")).map((actor) => `@${actor.handle}`) ?? []),
  ]);
  /** Without any stored tree the visible participants are split once; only a real change is saved. */
  const fallbackRoot = useMemo(() => personalLayout === null && programLayout.layout?.root === undefined
    ? initialTileLayout([
      ...visibleApps,
      ...(runView?.actors.filter((actor) => actor.kind !== "human" && actor.lifecycle?.kind !== "stopped" && !hiddenActorIds.includes(actor.id)).map((actor) => `@${actor.handle}`) ?? []),
    ])
    : null, [personalLayout, programLayout, visibleApps, runView, hiddenActorIds]);
  const root = presentation.root ?? fallbackRoot;
  const hasVisibleContent = tileEntities(root).some((entity) => visibleEntities.has(entity));
  const stageEntities = useMemo(() => new Set(tileEntities(root)), [root]);
  useEffect(() => publishStageEntities(session.session.id, stageEntities), [session.session.id, stageEntities]);
  useEffect(() => () => publishStageEntities(session.session.id, undefined), [session.session.id]);
  const startupState = canvasStartupState({ view: runView, startup: session.startup, connected: session.connected,
    running: session.running, error: session.conversationError });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const showStartup = !hasVisibleContent && startupState !== undefined;

  const visibleStageSize = useCallback((): { width: number; height: number } | undefined => {
    const element = stageRef.current;
    if (!element) return undefined;
    const stage = element.getBoundingClientRect();
    const panel = document.getElementById("workspace-panel")?.getBoundingClientRect();
    const overlap = panel ? Math.min(stage.right, panel.right) - Math.max(stage.left, panel.left) : 0;
    return { width: stage.width - Math.max(0, overlap), height: stage.height };
  }, []);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const size = visibleStageSize();
      if (size) element.style.setProperty("--canvas-visible-width", `${size.width}px`);
    });
    observer.observe(element);
    const panel = document.getElementById("workspace-panel");
    if (panel) observer.observe(panel);
    return () => observer.disconnect();
  }, [visibleStageSize]);

  const handleSelect = useCallback((selection: EntityReference) => {
    canvas.acceptSelection(selection);
  }, [canvas]);

  const changeTiles = (next: CanvasTileNode | null) => {
    try {
      saveCanvasPresentation(session.session.id, { root: next, programBasis });
      setPresentationError(undefined);
    } catch (error) {
      setPresentationError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-clip" data-view="tiled">
      {personalLayout && <StatusGroup container={statusContainer} label="Kachelfläche" order={20}>
        <button className={statusControlClass} onClick={() => saveCanvasPresentation(session.session.id, null)}
          title="Eigene Anordnung zurücksetzen und der Programmanordnung folgen" type="button">Programmvorgabe übernehmen</button>
      </StatusGroup>}
      {runToolbarContainer && createPortal(<><ActorHeaderModeControl runId={session.session.id} />{inspect && <ActorCanvasControls session={session}
        appActorIds={appActorIds} preferences={preferences}
        onPreferencesChange={(next) => saveCanvasViewPreferences(session.session.id, next)} />}</>, runToolbarContainer)}
      <div aria-label="Kachelfläche" className="relative min-h-0 min-w-0 flex-[1_1_360px] overflow-clip bg-[image:var(--canvas-backdrop)]" ref={stageRef}>
        <CanvasGrain />
        {(programLayout.error || presentationError) && <p className="absolute inset-x-2 top-2 z-10 bg-secondary p-3 text-destructive" role="alert">{programLayout.error || presentationError}</p>}
        {runView && !showStartup && <div className="absolute inset-y-0 left-0 w-[var(--canvas-visible-width,100%)] overflow-hidden">
          <CanvasTiles root={root} onChange={changeTiles}
            canvasElements={canvasElements} cardSections={cardSections} session={session} view={runView} navigation={navigation} onSelect={handleSelect}
            selected={canvas.selection} />
        </div>}
        {showStartup && <CanvasStartup state={startupState} />}
      </div>
    </div>
  );
}

/** Feines Rauschen über der Fläche, damit das Material nicht glatt wirkt. */
function CanvasGrain() {
  return <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full opacity-10" preserveAspectRatio="none" viewBox="0 0 180 180">
    <filter id="canvas-grain"><feTurbulence baseFrequency=".76" numOctaves="3" stitchTiles="stitch" type="fractalNoise" /></filter>
    <path d="M0 0h180v180H0z" fill="#887890" filter="url(#canvas-grain)" opacity=".32" />
  </svg>;
}
