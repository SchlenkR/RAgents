import { useAccess } from "@aicontainer/web/AccessContext";
import { useMaterialSettings } from "@aicontainer/web/material-settings";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Scan } from "lucide-react";
import { CanvasTiles } from "./CanvasTiles";
import { CanvasStartup } from "./CanvasStartup";
import { canvasStartupState } from "./canvas-startup";
import { tileEntities } from "./tile-docking";
import { publishStageEntities } from "./canvas-stage";
import { initialTileLayout, saveCanvasPresentation, useCanvasPresentation } from "./tiled-view-settings";
import { StatusGroup } from "@aicontainer/web/StatusGroup";
import { Alert, AlertDescription } from "@aicontainer/web/ui";
import { NetLayer, type NetBounds } from "./ActorNet";
import { ORCHESTRATION_TAB_ID, statusControlClass, statusOutputClass } from "./constants";
import { runViewFrom } from "./run-view";
import { usePinchZoomSensitivity } from "./zoom-settings";
import { ActorCanvasControls, ActorHeaderModeControl } from "./ActorCanvasControls";
import { actorVisibleOnCanvas, saveCanvasViewPreferences, useCanvasViewPreferences } from "./canvas-view-settings";
import { useCanvasController, type CanvasCenterContext, type EntityReference } from "@aicontainer/web/PluginRegistry";

import { canvasLayoutStorageKey, parseCanvasCamera, type CanvasCamera as Camera } from "./canvas-layout-storage";
import { createKeyboardNavigation, nextCanvasElement, type CanvasNavigationBox } from "./keyboard-navigation";

const INITIAL_INSET = 32;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 2.5;

const wheelPixels = (deltaY: number, deltaMode: number): number =>
  deltaY * (deltaMode === 1 ? 18 : deltaMode === 2 ? 120 : 1);

export function OrchestrationCenter(props: CanvasCenterContext) {
  return <RunOrchestrationCenter key={props.session.session.id} {...props} />;
}

function RunOrchestrationCenter({
  cardSections,
  canvasElements,
  navigation,
  onCenterModeChange,
  session,
  statusContainer,
  toolbarContainer,
  runToolbarContainer,
}: CanvasCenterContext) {
  const inspect = useAccess().can("runs.inspect");
  const canvas = useCanvasController();
  const pinchZoomSensitivity = usePinchZoomSensitivity();
  if (canvas?.tabId !== ORCHESTRATION_TAB_ID) {
    throw new Error("Canvas-Beitrag und Canvas-Provider passen nicht zusammen");
  }
  const selectionHandler = useRef(canvas.acceptSelection);
  useLayoutEffect(() => { selectionHandler.current = canvas.acceptSelection; }, [canvas.acceptSelection]);
  const lastRunView = useRef<ReturnType<typeof runViewFrom>>(undefined);
  const parsedRunView = runViewFrom(session.runView);
  if (parsedRunView !== undefined) lastRunView.current = parsedRunView;
  const runView = parsedRunView ?? lastRunView.current;
  const { programLayout, personalLayout, presentation, programBasis } = useCanvasPresentation(session.session.id, runView);
  const tiled = presentation.mode === "tiled";
  const [presentationError, setPresentationError] = useState<string>();
  const preferences = useCanvasViewPreferences(session.session.id);
  const appActorIds = useMemo(() => new Set(canvasElements.flatMap((contribution) => contribution.select(session)
    .flatMap((element) => element.anchorActorId ? [element.anchorActorId] : []))), [canvasElements, session]);
  const hiddenActorIds = useMemo(() => runView?.actors
    .filter((actor) => actor.kind !== "human" && (inspect ? !actorVisibleOnCanvas(actor, appActorIds, preferences, runView.primaryActorId) : actor.kind === "script")).map((actor) => actor.id) ?? [],
  [inspect, runView, appActorIds, preferences]);
  const canvasReady = runView !== undefined && (runView.actors.some((actor) => actor.kind !== "human")
    || canvasElements.some((contribution) => contribution.select(session).some((element) => element.visible !== false)));
  const visibleApps = useMemo(() => canvasElements.flatMap((contribution) => contribution.select(session)
    .filter((element) => element.visible !== false).map((element) => `app:${element.id}`)), [canvasElements, session]);
  const visibleEntities = new Set([
    ...visibleApps,
    ...(runView?.actors.filter((actor) => actor.kind !== "human" && actor.lifecycle?.kind !== "stopped"
      && (tiled ? inspect || actor.kind === "agent" : !hiddenActorIds.includes(actor.id))).map((actor) => `@${actor.handle}`) ?? []),
  ]);
  const hasVisibleContent = tiled ? tileEntities(presentation.root).some((entity) => visibleEntities.has(entity)) : visibleEntities.size > 0;
  const stageEntities = useMemo(() => new Set(tiled ? tileEntities(presentation.root) : [
    ...visibleApps,
    ...(runView?.actors.filter((actor) => actor.kind !== "human" && !hiddenActorIds.includes(actor.id)).map((actor) => `@${actor.handle}`) ?? []),
  ]), [tiled, presentation.root, visibleApps, runView, hiddenActorIds]);
  useEffect(() => publishStageEntities(session.session.id, stageEntities), [session.session.id, stageEntities]);
  useEffect(() => () => publishStageEntities(session.session.id, undefined), [session.session.id]);
  const startupState = canvasStartupState({ view: runView, startup: session.startup, connected: session.connected,
    running: session.running, error: session.conversationError });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const { error: materialSettingsError } = useMaterialSettings();
  const worldRef = useRef<HTMLDivElement>(null);
  const storageKey = canvasLayoutStorageKey(session.session.id, "camera");
  const [savedCamera] = useState(() => parseCanvasCamera(window.localStorage.getItem(storageKey)));
  const camera = useRef<Camera>(savedCamera ?? { x: INITIAL_INSET, y: INITIAL_INSET, zoom: 1 });
  const pendingCamera = useRef<Camera | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushCamera = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (!pendingCamera.current) return;
    window.localStorage.setItem(storageKey, JSON.stringify(pendingCamera.current));
    pendingCamera.current = undefined;
  }, [storageKey]);
  useEffect(() => {
    window.addEventListener("pagehide", flushCamera);
    return () => { window.removeEventListener("pagehide", flushCamera); flushCamera(); };
  }, [flushCamera]);
  const [overviewCamera, setOverviewCamera] = useState<Camera>();
  const [hasScene, setHasScene] = useState<boolean>();
  const showStartup = !hasVisibleContent && (tiled || hasScene !== true) && startupState !== undefined;
  const overview = overviewCamera !== undefined;
  const overviewButtonRef = useRef<HTMLButtonElement>(null);
  const cameraSettled = useRef(savedCamera !== undefined);
  const boundsRef = useRef<NetBounds | null>(null);
  const zoomOutputRef = useRef<HTMLOutputElement>(null);
  const bindZoomOutput = useCallback((element: HTMLOutputElement | null) => {
    zoomOutputRef.current = element;
    if (element) element.textContent = `${Math.round(camera.current.zoom * 100)}%`;
  }, []);
  useEffect(() => {
    onCenterModeChange(canvasReady ? "workflow" : "chat");
    if (!canvasReady) {
      boundsRef.current = null;
      setOverviewCamera(undefined);
    }
  }, [canvasReady, onCenterModeChange]);

  const visibleStageSize = useCallback((): { width: number; height: number } | undefined => {
    const element = stageRef.current;
    if (!element) return undefined;
    const stage = element.getBoundingClientRect();
    const panel = document.getElementById("workspace-panel")?.getBoundingClientRect();
    const overlap = panel ? Math.min(stage.right, panel.right) - Math.max(stage.left, panel.left) : 0;
    return { width: stage.width - Math.max(0, overlap), height: stage.height };
  }, []);

  const renderCamera = useCallback((next: Camera, persist = true) => {
    const zoom = Math.min(ZOOM_MAX, Math.max(Number.MIN_VALUE, next.zoom));
    camera.current = { x: next.x, y: next.y, zoom };
    if (persist) {
      pendingCamera.current = camera.current;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flushCamera, 150);
    }
    const world = worldRef.current;
    if (world) {
      world.style.setProperty("--cam-x", `${next.x}px`);
      world.style.setProperty("--cam-y", `${next.y}px`);
      world.style.setProperty("--cam-zoom", String(zoom));
    }
    const output = zoomOutputRef.current;
    if (output) output.textContent = `${Math.round(zoom * 100)}%`;
  }, [flushCamera]);

  const keyboardNavigation = useMemo(() => createKeyboardNavigation(() => camera.current, renderCamera), [renderCamera]);
  const keyboardTarget = useRef<string | undefined>(undefined);
  const cancelKeyboardNavigation = useCallback(() => {
    keyboardNavigation.cancel();
    keyboardTarget.current = undefined;
  }, [keyboardNavigation]);
  useEffect(() => () => cancelKeyboardNavigation(), [cancelKeyboardNavigation]);
  const applyCamera = useCallback((next: Camera, persist = true) => {
    cancelKeyboardNavigation();
    renderCamera(next, persist);
  }, [cancelKeyboardNavigation, renderCamera]);

  useEffect(() => {
    if (tiled || !canvasReady || overview || hasScene === false) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const element = stageRef.current;
      if (!element || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || element.closest("[inert]") || element.getClientRects().length === 0) return;
      const target = event.target;
      if (target !== document.body && target !== document.documentElement
        && (!(target instanceof Node) || !element.contains(target) || controlUnder(target, element))) return;
      const size = visibleStageSize();
      if (!size || size.width <= 0 || size.height <= 0) return;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const stage = element.getBoundingClientRect();
      const centerX = stage.left + size.width / 2;
      const centerY = stage.top + size.height / 2;
      const elements = Array.from(element.querySelectorAll<HTMLElement>("[data-canvas-navigation-id]"))
        .filter((candidate) => candidate.getClientRects().length > 0 && !candidate.closest("[hidden], [inert]"))
        .map((candidate): CanvasNavigationBox => {
          const box = candidate.getBoundingClientRect();
          return { id: candidate.dataset.canvasNavigationId!, left: box.left, top: box.top, right: box.right, bottom: box.bottom };
        });
      const current = elements.find((candidate) => candidate.id === keyboardTarget.current)
        ?? elements.filter((candidate) => candidate.left <= centerX && candidate.right >= centerX && candidate.top <= centerY && candidate.bottom >= centerY)
          .sort((a, b) => Math.hypot((a.left + a.right) / 2 - centerX, (a.top + a.bottom) / 2 - centerY)
            - Math.hypot((b.left + b.right) / 2 - centerX, (b.top + b.bottom) / 2 - centerY))[0];
      const next = nextCanvasElement(elements, current ?? { left: centerX, right: centerX, top: centerY, bottom: centerY }, event.key, current?.id);
      if (!next) return;
      cameraSettled.current = true;
      if (keyboardNavigation.moveTo({
        x: camera.current.x + centerX - (next.left + next.right) / 2,
        y: camera.current.y + centerY - (next.top + next.bottom) / 2,
        zoom: camera.current.zoom,
      }, event.repeat, window.matchMedia("(prefers-reduced-motion: reduce)").matches)) keyboardTarget.current = next.id;
    };
    const cancel = cancelKeyboardNavigation;
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", cancel);
    document.addEventListener("focusin", cancel);
    document.addEventListener("pointerdown", cancel, true);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("focusin", cancel);
      document.removeEventListener("pointerdown", cancel, true);
      document.removeEventListener("visibilitychange", cancel);
      cancelKeyboardNavigation();
    };
  }, [tiled, canvasReady, hasScene, keyboardNavigation, cancelKeyboardNavigation, overview, visibleStageSize]);

  const bindWorld = useCallback((element: HTMLDivElement | null) => {
    worldRef.current = element;
    if (element) applyCamera(camera.current, false);
  }, [applyCamera]);

  const fitBounds = useCallback((bounds: NetBounds, { complete = false, initial = false } = {}): boolean => {
    const stage = visibleStageSize();
    if (!stage || stage.width <= 0 || stage.height <= 0) return false;
    const padding = initial ? INITIAL_INSET : 48;
    const width = Math.max(1, bounds.right - bounds.left);
    const height = Math.max(1, bounds.bottom - bounds.top);
    const zoom = Math.max(complete ? Number.MIN_VALUE : ZOOM_MIN, Math.min(
      Math.max(1, stage.width - padding * 2) / width,
      Math.max(1, stage.height - padding * 2) / height,
      1));
    applyCamera({
      x: initial ? padding - bounds.left * zoom : stage.width / 2 - (bounds.left + width / 2) * zoom,
      y: initial ? padding - bounds.top * zoom : stage.height / 2 - (bounds.top + height / 2) * zoom,
      zoom,
    }, !complete);
    return true;
  }, [applyCamera, visibleStageSize]);

  const fitScene = useCallback(() => {
    if (boundsRef.current && fitBounds(boundsRef.current, { initial: true })) cameraSettled.current = true;
  }, [fitBounds]);

  const fitInitialScene = useCallback(() => {
    if (!cameraSettled.current) fitScene();
  }, [fitScene]);

  const centerBounds = useCallback((bounds: NetBounds) => {
    const stage = visibleStageSize();
    if (!stage || stage.width <= 0 || stage.height <= 0) return;
    cameraSettled.current = true;
    setOverviewCamera(undefined);
    applyCamera({
      x: stage.width / 2 - (bounds.left + bounds.right) / 2,
      y: stage.height / 2 - (bounds.top + bounds.bottom) / 2,
      zoom: 1,
    });
  }, [applyCamera, visibleStageSize]);

  const resetScene = useCallback(() => {
    if (boundsRef.current) centerBounds(boundsRef.current);
  }, [centerBounds]);

  const closeOverview = useCallback(() => {
    if (!overviewCamera) return;
    applyCamera(overviewCamera);
    setOverviewCamera(undefined);
    overviewButtonRef.current?.focus({ preventScroll: true });
  }, [applyCamera, overviewCamera]);

  const toggleOverview = useCallback(() => {
    if (overviewCamera) { closeOverview(); return; }
    const previous = camera.current;
    if (!boundsRef.current || !fitBounds(boundsRef.current, { complete: true })) return;
    cameraSettled.current = true;
    setOverviewCamera(previous);
  }, [closeOverview, fitBounds, overviewCamera]);

  const focusOverviewTarget = useCallback((bounds: NetBounds) => {
    centerBounds(bounds);
    overviewButtonRef.current?.focus({ preventScroll: true });
  }, [centerBounds]);

  useEffect(() => {
    if (!overview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || stageRef.current?.closest("[inert]")) return;
      event.preventDefault();
      closeOverview();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeOverview, overview]);

  const requestedEntity = navigation.selectionFor(ORCHESTRATION_TAB_ID);
  useEffect(() => {
    if (tiled || !requestedEntity || typeof requestedEntity !== "object"
      || !("type" in requestedEntity) || !("id" in requestedEntity)) return;
    const frame = requestAnimationFrame(() => {
      const stage = stageRef.current;
      const element = Array.from(stage?.querySelectorAll<HTMLElement>("[data-canvas-entity-id]") ?? [])
        .find((candidate) => candidate.dataset.canvasEntityId === requestedEntity.id
          && candidate.dataset.canvasEntityType === requestedEntity.type);
      if (!stage || !element) return;
      const bounds = element.getBoundingClientRect();
      const viewport = stage.getBoundingClientRect();
      const { x, y, zoom } = camera.current;
      const left = (bounds.left - viewport.left - x) / zoom;
      const top = (bounds.top - viewport.top - y) / zoom;
      if (fitBounds({ left, top, right: left + bounds.width / zoom, bottom: top + bounds.height / zoom })) {
        cameraSettled.current = true;
        setOverviewCamera(undefined);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [tiled, requestedEntity, fitBounds]);

  const zoomAtStagePoint = useCallback((deltaY: number, deltaMode: number, stageX: number, stageY: number, sensitivity = 1) => {
    const current = camera.current;
    const worldX = (stageX - current.x) / current.zoom;
    const worldY = (stageY - current.y) / current.zoom;
    const zoom = Math.min(ZOOM_MAX, Math.max(Math.min(ZOOM_MIN, current.zoom), current.zoom * Math.exp(-wheelPixels(deltaY, deltaMode) * 0.0007 * sensitivity)));
    applyCamera({ x: stageX - worldX * zoom, y: stageY - worldY * zoom, zoom });
  }, [applyCamera]);

  const panBy = useCallback((dx: number, dy: number) => {
    const current = camera.current;
    applyCamera({ x: current.x + dx, y: current.y + dy, zoom: current.zoom });
  }, [applyCamera]);

  const zoomStep = useCallback((direction: number) => {
    const stage = visibleStageSize();
    if (!stage || stage.width <= 0 || stage.height <= 0) return;
    cameraSettled.current = true;
    setOverviewCamera(undefined);
    zoomAtStagePoint(direction > 0 ? -400 : 400, 0, stage.width / 2, stage.height / 2);
  }, [visibleStageSize, zoomAtStagePoint]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const size = visibleStageSize();
      if (size) element.style.setProperty("--canvas-visible-width", `${size.width}px`);
      if (tiled) return;
      if (overview && boundsRef.current) fitBounds(boundsRef.current, { complete: true });
      else fitInitialScene();
    });
    observer.observe(element);
    const panel = document.getElementById("workspace-panel");
    if (panel) observer.observe(panel);
    return () => observer.disconnect();
  }, [tiled, fitBounds, fitInitialScene, overview, visibleStageSize]);

  const handleLayout = useCallback((bounds: NetBounds) => {
    const visible = bounds.right > bounds.left || bounds.bottom > bounds.top;
    setHasScene(visible);
    if (!visible) {
      boundsRef.current = null;
      setOverviewCamera(undefined);
      return;
    }
    boundsRef.current = bounds;
    if (overview) fitBounds(bounds, { complete: true });
    else fitInitialScene();
  }, [fitBounds, fitInitialScene, overview]);

  const handleSelect = useCallback((selection: EntityReference) => {
    canvas?.acceptSelection(selection);
  }, [canvas]);

  const stageCleanup = useRef<(() => void) | undefined>(undefined);
  const bindStage = useCallback((element: HTMLDivElement | null) => {
    stageCleanup.current?.();
    stageCleanup.current = undefined;
    stageRef.current = element;
    if (!element || tiled) return;
    let panCleanup: (() => void) | undefined;

    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || (!overview && controlUnder(event.target, element))) return;
      event.preventDefault();
      setOverviewCamera(undefined);
      const rect = element.getBoundingClientRect();
      cameraSettled.current = true;
      zoomAtStagePoint(event.deltaY, event.deltaMode, event.clientX - rect.left, event.clientY - rect.top,
        event.ctrlKey ? pinchZoomSensitivity : 1);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (overview) return;
      if (event.defaultPrevented || controlUnder(event.target, element)) return;
      const middleButton = event.button === 1;
      const leftButton = event.button === 0;
      if (!middleButton && !leftButton) return;
      event.preventDefault();
      cancelKeyboardNavigation();
      element.focus({ preventScroll: true });
      panCleanup?.();
      const startX = event.clientX;
      const startY = event.clientY;
      let lastX = event.clientX;
      let lastY = event.clientY;
      let dragged = false;
      let active = true;
      element.setPointerCapture(event.pointerId);
      const move = (moved: PointerEvent) => {
        if (!active || moved.pointerId !== event.pointerId) return;
        dragged ||= Math.hypot(moved.clientX - startX, moved.clientY - startY) > 4;
        cameraSettled.current = true;
        panBy(moved.clientX - lastX, moved.clientY - lastY);
        lastX = moved.clientX;
        lastY = moved.clientY;
      };
      const cleanup = () => {
        if (!active) return;
        active = false;
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerup", end);
        element.removeEventListener("pointercancel", end);
        element.removeEventListener("lostpointercapture", end);
        if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
        panCleanup = undefined;
      };
      const end = (ended: PointerEvent) => {
        if (!active || ended.pointerId !== event.pointerId) return;
        cleanup();
        if (ended.type === "pointerup" && leftButton && !dragged) selectionHandler.current(undefined);
      };
      panCleanup = cleanup;
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerup", end);
      element.addEventListener("pointercancel", end);
      element.addEventListener("lostpointercapture", end);
    };

    const onDoubleClick = (event: MouseEvent) => {
      if (overview) return;
      if (event.defaultPrevented || controlUnder(event.target, element)) return;
      resetScene();
    };

    const onMiddleDown = (event: MouseEvent) => {
      if (event.defaultPrevented || controlUnder(event.target, element)) return;
      if (event.button === 1) event.preventDefault();
    };

    const onScroll = () => {
      element.scrollLeft = 0;
      element.scrollTop = 0;
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("dblclick", onDoubleClick);
    element.addEventListener("mousedown", onMiddleDown);
    element.addEventListener("auxclick", onMiddleDown);
    element.addEventListener("scroll", onScroll);
    onScroll();
    stageCleanup.current = () => {
      panCleanup?.();
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("dblclick", onDoubleClick);
      element.removeEventListener("mousedown", onMiddleDown);
      element.removeEventListener("auxclick", onMiddleDown);
      element.removeEventListener("scroll", onScroll);
    };
  }, [tiled, resetScene, overview, panBy, pinchZoomSensitivity, zoomAtStagePoint, cancelKeyboardNavigation]);

  useEffect(() => {
    if (!tiled) return;
    cancelKeyboardNavigation();
    if (overviewCamera) {
      applyCamera(overviewCamera);
      setOverviewCamera(undefined);
    }
  }, [tiled, overviewCamera, applyCamera, cancelKeyboardNavigation]);

  const changeMode = (mode: "free" | "tiled") => {
    if (mode === presentation.mode) return;
    const entities = [
      ...canvasElements.flatMap((contribution) => contribution.select(session).filter((element) => element.visible !== false).map((element) => `app:${element.id}`)),
      ...(runView?.actors.filter((actor) => actor.kind !== "human" && actor.lifecycle?.kind !== "stopped" && !hiddenActorIds.includes(actor.id)).map((actor) => `@${actor.handle}`) ?? []),
    ];
    try {
      saveCanvasPresentation(session.session.id, { mode, programBasis, root: presentation.root ?? (personalLayout === null && programLayout.layout?.root === undefined ? initialTileLayout(entities) : null) });
      setPresentationError(undefined);
    } catch (error) {
      setPresentationError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-clip" data-view={tiled ? "tiled" : "net"}>
      {materialSettingsError && <Alert className="absolute inset-x-4.5 bottom-4.5 z-30 w-auto" role="status" variant="destructive"><AlertDescription className="text-destructive">{materialSettingsError}</AlertDescription></Alert>}
      {toolbarContainer && createPortal(<button
        aria-label="Canvas-Übersicht"
        aria-pressed={overview}
        className="inline-flex size-header min-h-header items-center justify-center border-r border-border bg-transparent text-primary transition-colors hover:not-disabled:bg-accent focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-3 aria-expanded:bg-primary aria-expanded:text-primary-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground disabled:opacity-45"
        disabled={tiled || !canvasReady || hasScene === false}
        onClick={toggleOverview}
        ref={overviewButtonRef}
        title={tiled ? "Die Canvas-Übersicht ist im Kachelmodus nicht verfügbar" : overview ? "Canvas-Übersicht beenden (Escape)" : "Alle Elemente anzeigen und anspringen"}
        type="button"
      ><Scan aria-hidden size={22} /></button>, toolbarContainer)}
      <StatusGroup container={statusContainer} label="Diagramm steuern" order={10}>
        <button aria-label="Verkleinern" className={statusControlClass} disabled={tiled} onClick={() => zoomStep(-1)} type="button">-</button>
        <output aria-label={tiled ? "Feste Kachelfläche" : "Zoomstufe"} className={statusOutputClass} ref={tiled ? undefined : bindZoomOutput}>{tiled ? "Fest" : "100%"}</output>
        <button aria-label="Vergrößern" className={statusControlClass} disabled={tiled} onClick={() => zoomStep(1)} type="button">+</button>
        <button className={statusControlClass} disabled={tiled} onClick={resetScene} title="Inhalt bei 100 Prozent zentrieren" type="button">Einpassen</button>
      </StatusGroup>
      <StatusGroup container={statusContainer} label="Flächenmodus" order={20}>
        <button className={statusControlClass} aria-pressed={!tiled} onClick={() => changeMode("free")} type="button">Frei</button>
        <button className={statusControlClass} aria-pressed={tiled} onClick={() => changeMode("tiled")} type="button">Kacheln</button>
        {personalLayout && <button className={statusControlClass} onClick={() => saveCanvasPresentation(session.session.id, null)}
          title="Eigene Anordnung zurücksetzen und der Programmanordnung folgen" type="button">Programmvorgabe übernehmen</button>}
      </StatusGroup>
      {inspect && !tiled && <StatusGroup container={statusContainer} label="Canvas-Ansicht" order={30}>
        <ActorCanvasControls control="view" session={session} appActorIds={appActorIds} preferences={preferences}
          onPreferencesChange={(next) => saveCanvasViewPreferences(session.session.id, next)} />
      </StatusGroup>}
      {runToolbarContainer && createPortal(<><ActorHeaderModeControl runId={session.session.id} />{inspect && <ActorCanvasControls control="actors" session={session}
        appActorIds={appActorIds} preferences={preferences}
        onPreferencesChange={(next) => saveCanvasViewPreferences(session.session.id, next)} />}</>, runToolbarContainer)}
      <div aria-label={tiled ? "Kachelfläche" : "Canvas, mit Pfeiltasten zum nächsten Element"} className="relative min-h-0 min-w-0 flex-[1_1_360px] overflow-clip bg-[image:var(--canvas-backdrop)]" ref={bindStage} tabIndex={0}>
        <CanvasGrain />
        {(programLayout.error || presentationError) && <p className="absolute inset-x-2 top-2 z-10 bg-secondary p-3 text-destructive" role="alert">{programLayout.error || presentationError}</p>}
        {tiled && runView && !showStartup && <div className="absolute inset-y-0 left-0 w-[var(--canvas-visible-width,100%)] overflow-hidden">
          <CanvasTiles root={presentation.root} onChange={(root) => saveCanvasPresentation(session.session.id, { mode: "tiled", root, programBasis })}
            canvasElements={canvasElements} cardSections={cardSections} session={session} view={runView} navigation={navigation} onSelect={handleSelect}
            selected={requestedEntity && typeof requestedEntity === "object" && "type" in requestedEntity && "id" in requestedEntity ? requestedEntity as EntityReference : undefined} />
        </div>}
        {!tiled && <div className="absolute top-0 left-0 h-0 w-0 origin-top-left overflow-visible [transform:translate(var(--cam-x,0px),var(--cam-y,0px))_scale(var(--cam-zoom,1))]" ref={bindWorld}>
          {canvasReady && runView && (
            <NetLayer
              cardSections={cardSections}
              canvasElements={canvasElements}
              hiddenActorIds={hiddenActorIds}
              showConnections={inspect && preferences.showConnections}
              navigation={navigation}
              onLayout={handleLayout}
              onSelect={handleSelect}
              onOverviewTarget={overview ? focusOverviewTarget : undefined}
              selectedActorId={canvas?.selection?.type === "actor" ? canvas.selection.id : undefined}
              session={session}
              view={runView}
            />
          )}
        </div>}
        {!tiled && overview && <p className="pointer-events-none absolute top-3 left-3 max-w-[calc(var(--canvas-visible-width,100%)-24px)] rounded-lg border border-border bg-card px-3 py-2 text-[.75rem] text-foreground" role="status">Element anklicken zum Anspringen. Escape bricht ab.</p>}
        {showStartup && <CanvasStartup state={startupState} />}
        {!showStartup && !tiled && (!canvasReady || hasScene === false) && (
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-[0.85rem] text-muted-foreground">{canvasReady
            ? "Keine Elemente eingeblendet. Über Actors oder Ansicht kannst du die Darstellung ändern."
            : "Die Fläche füllt sich, sobald der Run Actors hat."}</p>
        )}
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

function controlUnder(target: EventTarget | null, limit: HTMLElement): boolean {
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    if (node.matches("[data-canvas-card], [data-canvas-scroll], iframe, a, button, input, select, textarea, [contenteditable], [role=button], [role=slider], [role=spinbutton]")) return true;
    const style = getComputedStyle(node);
    if ((style.overflowY === "auto" || style.overflowY === "scroll")
      || (style.overflowX === "auto" || style.overflowX === "scroll")) return true;
    if (node === limit) break;
  }
  return false;
}
