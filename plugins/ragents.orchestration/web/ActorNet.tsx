import { withMaterialSpacing } from "./material-layout";
import { MaterialBody, materialCardClass, materialHeadClass, materialIconClass, materialTitleClass } from "./MaterialBody";
import { MATERIAL_DEPTH_PER_STEP, useMaterialSettings } from "@aicontainer/web/material-settings";
import { canvasLayoutStorageKey, parseCanvasElementSizes } from "./canvas-layout-storage";
import { Button, Card, SvgEdge, cn } from "@aicontainer/web/ui";
import { WorkingScenes } from "@aicontainer/web/chat/WorkingScenes";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ORCHESTRATION_PLUGIN_ID, canvasLayoutOf, type CanvasLayout, type CanvasShape } from "../contract";
import { cardSectionsClass } from "./constants";
import { layoutScene, lineGeometry, withLabelSpacing, type PlacedBox } from "./canvas-layout";
import { boundaryOf, buildScene, type SceneApp } from "./canvas-scene";
import { actorSurface, isPendingRunActorInput, type RunActor, type RunView } from "./run-view";
import { useCanvasMeasurements } from "./useCanvasMeasurements";
import { ActorChatPreview } from "./ActorChatPreview";
import { ScriptActorCard } from "./ScriptActorCard";
import { ACTOR_CARD_SIZE_LIMITS, useActorCardSize, type ActorCardSize } from "./card-size-settings";
import type {
  CanvasElementContribution,
  CanvasElementDefinition,
  CardSectionContribution,
  EntityReference,
  SessionContext,
  SessionNavigation,
} from "@aicontainer/web/PluginRegistry";

export interface NetBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface CanvasElementInstance {
  layoutKey: string;
  contribution: CanvasElementContribution;
  definition: CanvasElementDefinition;
}

interface ResizeTarget {
  key: string;
  limits: NonNullable<CanvasElementDefinition["resizable"]>;
  onCommit: (size: { width: number; height: number }) => void;
}

type ActorState = "running" | "waiting" | "done" | "failed" | "stopped";
type ActorRole = "primary" | "agent";

const resizeHandleClass = "absolute right-0.5 bottom-0.5 z-6 block size-5 min-h-5 min-w-5 cursor-nwse-resize touch-none rounded-md p-0 text-black/70 before:pointer-events-none before:absolute before:inset-1 before:rounded-br-full before:border-r-2 before:border-b-2 before:border-current before:content-[\'\'] focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2";

const NOTICE_GAP = 32;
const NOTICE_LINE = 22;
const NOTICE_PADDING = 12;
const NOTICE_WIDTH = 520;

const lifecycleKind = (view: RunView, actor: RunActor): ActorState => {
  const lifecycle = actor.lifecycle?.kind ?? "idle";
  if (lifecycle === "stopped") return "stopped";
  if (lifecycle === "running") return "running";
  const turns = view.turns.filter((turn) => turn.actorId === actor.id);
  const latest = turns.at(-1);
  if (latest?.status === "failed" || latest?.status === "interrupted") return "failed";
  const pendingInputs = view.inputs.filter((input) => input.actorId === actor.id && isPendingRunActorInput(input)).length;
  return latest?.status === "completed" && pendingInputs === 0 ? "done" : "waiting";
};

const roleOf = (view: RunView, actor: RunActor): ActorRole =>
  actor.id === view.primaryActorId ? "primary" : "agent";

const fallbackSize = (actor: RunActor, standardSize: ActorCardSize) => actor.kind === "agent" ? standardSize : ({
  width: actor.kind === "script" ? 300 : Math.min(320, Math.max(150, 66 + (actor.handle.length + 1) * 8.5)),
  height: actor.kind === "script" ? 98 : 44,
});

const canvasElementInstances = (
  contributions: readonly CanvasElementContribution[],
  session: SessionContext,
): CanvasElementInstance[] => {
  const instances = contributions.flatMap((contribution) => contribution.select(session).map((definition) => ({
    layoutKey: `canvas:${JSON.stringify([contribution.id, definition.id])}`,
    contribution,
    definition,
  })));
  if (new Set(instances.map((instance) => instance.layoutKey)).size !== instances.length) {
    throw new Error("Ein Canvas-Element wurde mehrfach ausgewählt");
  }
  for (const instance of instances) {
    if (!instance.definition.id.trim()) throw new Error("Ein Canvas-Element hat keine ID");
    if (!Number.isFinite(instance.definition.width) || instance.definition.width <= 0
      || !Number.isFinite(instance.definition.height) || instance.definition.height <= 0) {
      throw new Error(`Canvas-Element ${instance.definition.id} hat eine ungültige Größe`);
    }
    const collapsedHeight = instance.definition.collapsedHeight;
    if (collapsedHeight !== undefined && (!Number.isFinite(collapsedHeight) || collapsedHeight <= 0)) {
      throw new Error(`Canvas-Element ${instance.definition.id} hat eine ungültige eingeklappte Höhe`);
    }
    const resize = instance.definition.resizable;
    if (resize && (!Number.isFinite(resize.minWidth)
      || !Number.isFinite(resize.maxWidth)
      || !Number.isFinite(resize.minHeight)
      || !Number.isFinite(resize.maxHeight)
      || resize.minWidth <= 0
      || resize.minHeight <= 0
      || resize.maxWidth < resize.minWidth
      || resize.maxHeight < resize.minHeight)) {
      throw new Error(`Canvas-Element ${instance.definition.id} hat ungültige Größenlimits`);
    }
  }
  return instances;
};

const parsedLayout = (state: unknown): { layout?: CanvasLayout; problem?: string } => {
  if (state === undefined) return {};
  try {
    return { layout: canvasLayoutOf(state) };
  } catch (caught) {
    return { problem: caught instanceof Error ? caught.message : String(caught) };
  }
};

const STATE_WORDS: Record<ActorState, string> = {
  running: "arbeitet",
  waiting: "wartet",
  done: "fertig",
  failed: "gescheitert",
  stopped: "gestoppt",
};

const cardTitle = (actor: RunActor, state: ActorState, inputCount: number): string => {
  const head = `@${actor.handle} ${STATE_WORDS[state]}, ${inputCount} Eingaben`;
  const reason = actor.lifecycle?.kind === "stopped" ? actor.lifecycle.reason : undefined;
  return reason ? `${head}: ${reason}` : head;
};

const RoleIcon = ({ role }: { role: ActorRole }) => {
  if (role === "primary") {
    return (
      <svg aria-hidden viewBox="0 0 16 16">
        <path d="M 8 1.6 L 9.6 6.4 L 14.4 8 L 9.6 9.6 L 8 14.4 L 6.4 9.6 L 1.6 8 L 6.4 6.4 Z" />
      </svg>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 16 16">
      <path d="M 2.5 3.5 h 11 v 7 h -6 l -3 3 v -3 h -2 z" />
    </svg>
  );
};

const ShapeOutline = ({ shape, box }: { shape: CanvasShape; box: PlacedBox }) => {
  const inset = 1.5;
  const { width, height } = box;
  return (
    <svg aria-hidden height="100%" viewBox={`0 0 ${width} ${height}`} width="100%">
      {shape.kind === "circle"
        ? <circle cx={width / 2} cy={height / 2} r={Math.min(width, height) / 2 - inset} />
        : <polygon points={`${width / 2},${inset} ${width - inset},${height / 2} ${width / 2},${height - inset} ${inset},${height / 2}`} />}
    </svg>
  );
};

export function NetLayer({
  cardSections,
  canvasElements,
  hiddenActorIds,
  showConnections,
  navigation,
  onLayout,
  onSelect,
  onOverviewTarget,
  selectedActorId,
  session,
  view,
}: {
  cardSections: readonly CardSectionContribution[];
  canvasElements: readonly CanvasElementContribution[];
  hiddenActorIds: readonly string[];
  showConnections: boolean;
  navigation: SessionNavigation;
  onLayout: (bounds: NetBounds) => void;
  onSelect: (selection: EntityReference) => void;
  onOverviewTarget?: (bounds: NetBounds) => void;
  selectedActorId: string | undefined;
  session: SessionContext;
  view: RunView;
}) {
  const { sizes, refFor } = useCanvasMeasurements();
  const standardSize = useActorCardSize();
  const { settings: materialSettings } = useMaterialSettings();
  const storageKey = canvasLayoutStorageKey(session.session.id, "elements");
  const [savedSizes] = useState(() => parseCanvasElementSizes(window.localStorage.getItem(storageKey)));
  const [canvasSizes, setCanvasSizes] = useState<Map<string, { width: number; height: number }>>(() => new Map(savedSizes.canvasSizes));
  const [actorSizes, setActorSizes] = useState<Map<string, { width: number; height: number }>>(() => new Map(savedSizes.actorSizes));
  const [expandedActors, setExpandedActors] = useState<ReadonlySet<string>>(() => new Set(savedSizes.expandedActors));
  const [collapsedElements, setCollapsedElements] = useState<ReadonlySet<string>>(() => new Set(savedSizes.collapsedElements));
  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify({
      canvasSizes: [...canvasSizes], actorSizes: [...actorSizes],
      expandedActors: [...expandedActors], collapsedElements: [...collapsedElements],
    }));
  }, [storageKey, canvasSizes, actorSizes, expandedActors, collapsedElements]);
  const [hoveredId, setHoveredId] = useState<string>();
  const resizeSession = useRef<{ key: string; cancel: () => void } | null>(null);

  const allElementInstances = useMemo(
    () => canvasElementInstances(canvasElements, session),
    [canvasElements, session],
  );
  const rawElementInstances = useMemo(
    () => allElementInstances.filter((instance) => instance.definition.visible !== false),
    [allElementInstances],
  );
  const hiddenAppIds = useMemo(
    () => allElementInstances.filter((instance) => instance.definition.visible === false).map((instance) => instance.definition.id),
    [allElementInstances],
  );
  useLayoutEffect(() => {
    const actorIds = new Set(view.actors.filter((actor) => actor.kind === "agent").map((actor) => actor.id));
    const visibleKeys = new Set([...rawElementInstances.map((instance) => instance.layoutKey), ...[...actorIds].filter((id) => !hiddenActorIds.includes(id)).map((id) => `actor:${id}`)]);
    if (resizeSession.current && !visibleKeys.has(resizeSession.current.key)) resizeSession.current.cancel();
    setActorSizes((current) => [...current.keys()].every((id) => actorIds.has(id))
      ? current : new Map([...current].filter(([id]) => actorIds.has(id))));
    setExpandedActors((current) => [...current].every((id) => actorIds.has(id))
      ? current : new Set([...current].filter((id) => actorIds.has(id))));
    const keys = new Set(allElementInstances.map((instance) => instance.layoutKey));
    setCanvasSizes((current) => [...current.keys()].every((key) => keys.has(key))
      ? current : new Map([...current].filter(([key]) => keys.has(key))));
    setCollapsedElements((current) => [...current].every((key) => keys.has(key))
      ? current : new Set([...current].filter((key) => keys.has(key))));
  }, [rawElementInstances, allElementInstances, view.actors, hiddenActorIds]);
  useLayoutEffect(() => () => resizeSession.current?.cancel(), []);
  const elementInstances = useMemo(
    () => rawElementInstances.map((instance) => {
      const size = canvasSizes.get(instance.layoutKey);
      const collapsedHeight = collapsedElements.has(instance.layoutKey) ? instance.definition.collapsedHeight : undefined;
      return { ...instance, definition: { ...instance.definition, ...size,
        ...(collapsedHeight === undefined ? {} : { height: collapsedHeight }),
      } };
    }),
    [rawElementInstances, canvasSizes, collapsedElements],
  );

  const layoutState = view.pluginStates.find((entry) =>
    entry.pluginId === ORCHESTRATION_PLUGIN_ID && entry.scope.kind === "run")?.state;
  const parsed = useMemo(() => parsedLayout(layoutState), [layoutState]);
  const apps = useMemo(
    (): SceneApp[] => elementInstances.map((instance) => ({
      key: instance.layoutKey,
      id: instance.definition.id,
      width: instance.definition.width,
      height: instance.definition.height,
      ...sizes.get(instance.layoutKey),
      anchorActorId: instance.definition.anchorActorId,
    })),
    [elementInstances, sizes],
  );
  const scene = useMemo(() => buildScene({
    view,
    layout: parsed.layout,
    layoutProblem: parsed.problem,
    actorSize: (actor) => sizes.get(`actor:${actor.id}`) ?? fallbackSize(actor, standardSize),
    apps,
    hiddenAppIds,
    hiddenActorIds,
    showConnections,
  }), [view, parsed, sizes, apps, hiddenAppIds, hiddenActorIds, showConnections, standardSize]);

  // The layout starts at the world origin; the chat floats outside the camera world.
  const originX = 0;
  const originY = 0;
  const depth = materialSettings.steps * MATERIAL_DEPTH_PER_STEP;
  const placed = useMemo(() => layoutScene(withLabelSpacing(withMaterialSpacing(scene.root, depth), scene.lines
    .filter((line) => line.label?.trim())
    .map((line) => ({ ...line, ...(sizes.get(`label:${line.key}`) ?? { width: 0, height: 0 }) }))), originX, originY),
  [scene, sizes, originX, originY, depth]);
  const boxes = useMemo(() => new Map(placed.boxes.map((box) => [box.key, box])), [placed]);
  const hasMaterial = placed.boxes.some((box) => { const type = scene.leaves.get(box.key)?.type; return type === "actor" || type === "app"; });
  const materialDepth = hasMaterial ? depth : 0;
  const noticeHeight = scene.notices.length > 0 ? NOTICE_PADDING * 2 + scene.notices.length * NOTICE_LINE : 0;
  const noticeTop = originY + placed.height + (placed.height > 0 ? NOTICE_GAP : 0);
  const bounds = useMemo((): NetBounds => ({
    left: originX,
    top: originY - materialDepth * .7,
    right: originX + Math.max(placed.width + materialDepth * .5, noticeHeight > 0 ? NOTICE_WIDTH : 0),
    bottom: Math.max(originY + placed.height, noticeTop + noticeHeight),
  }), [originX, originY, placed.width, placed.height, noticeHeight, noticeTop, materialDepth]);

  const measured = [...scene.leaves].every(([key, leaf]) =>
    (leaf.type !== "actor" && leaf.type !== "app") || sizes.has(key))
    && scene.lines.every((line) => !line.label?.trim() || sizes.has(`label:${line.key}`));
  useLayoutEffect(() => {
    if (measured) onLayout(bounds);
  }, [bounds, measured, onLayout]);

  const elementByKey = new Map(elementInstances.map((element) => [element.layoutKey, element]));
  const focusActorId = hoveredId ?? selectedActorId;
  const focusKey = focusActorId === undefined ? undefined : `actor:${focusActorId}`;
  const lineClass = (touched: boolean) =>
    focusKey === undefined || touched ? undefined : "opacity-40";

  const startResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    target: ResizeTarget,
  ) => {
    const limits = target.limits;
    if (!limits || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const container = handle.parentElement;
    if (!container) return;
    resizeSession.current?.cancel();
    const originalWidth = container.style.width;
    const originalHeight = container.style.height;
    let width = container.offsetWidth;
    let height = container.offsetHeight;
    const pointerId = event.pointerId;
    let lastX = event.clientX;
    let lastY = event.clientY;
    let finished = false;
    let frame: number | null = null;
    let pendingX = lastX;
    let pendingY = lastY;
    const applySize = () => {
      frame = null;
      const zoom = container.getBoundingClientRect().width / container.offsetWidth;
      if (!Number.isFinite(zoom) || zoom <= 0) return;
      width = Math.min(limits.maxWidth, Math.max(limits.minWidth, width + (pendingX - lastX) / zoom));
      height = Math.min(limits.maxHeight, Math.max(limits.minHeight, height + (pendingY - lastY) / zoom));
      lastX = pendingX;
      lastY = pendingY;
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
    };
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      pendingX = moveEvent.clientX;
      pendingY = moveEvent.clientY;
      if (frame === null) frame = requestAnimationFrame(applySize);
    };
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      handle.removeEventListener("lostpointercapture", cancel);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      resizeSession.current = null;
      if (commit && container.isConnected) {
        target.onCommit({ width, height });
      } else {
        container.style.width = originalWidth;
        container.style.height = originalHeight;
      }
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      pendingX = upEvent.clientX;
      pendingY = upEvent.clientY;
      if (frame !== null) cancelAnimationFrame(frame);
      applySize();
      finish(true);
    };
    const cancel = (cancelEvent: PointerEvent) => { if (cancelEvent.pointerId === pointerId) finish(false); };
    resizeSession.current = { key: target.key, cancel: () => finish(false) };
    handle.setPointerCapture(pointerId);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
    handle.addEventListener("lostpointercapture", cancel);
  };

  const renderActor = (actor: RunActor, box: PlacedBox) => {
    const state = lifecycleKind(view, actor);
    const inputCount = view.inputs.filter((input) => input.actorId === actor.id).length;
    const expanded = expandedActors.has(actor.id);
    const requestedExpandedSize = actorSizes.get(actor.id) ?? {
      width: Math.min(ACTOR_CARD_SIZE_LIMITS.maxWidth, Math.max(400, Math.round(standardSize.width * 1.5))),
      height: Math.min(ACTOR_CARD_SIZE_LIMITS.maxHeight, Math.max(340, Math.round(standardSize.height * 1.5))),
    };
    const expandedSize = { ...requestedExpandedSize, height: Math.max(ACTOR_CARD_SIZE_LIMITS.minHeight, requestedExpandedSize.height) };
    const saveSize = (size: { width: number; height: number }) => {
      setActorSizes((current) => new Map(current).set(actor.id, size));
      setExpandedActors((current) => new Set(current).add(actor.id));
    };
    return (
      <div
        className={materialCardClass(actorSurface(view, actor), cn(
          "absolute flex flex-col text-foreground",
          actor.kind === "agent" && "min-h-[260px] min-w-[240px] max-w-[2880px] pr-[22px] pb-2",
          actor.kind === "script" && "min-h-[98px] w-[300px]",
          actor.kind !== "agent" && actor.kind !== "script" && "max-w-[320px]",
          (state === "running" || actor.id === selectedActorId) && "border-primary",
        ))}
        key={box.key}
        data-surface="material"
        data-canvas-card="true"
        data-canvas-navigation-id={box.key}
        onPointerEnter={() => setHoveredId(actor.id)}
        onPointerLeave={() => setHoveredId((current) => (current === actor.id ? undefined : current))}
        ref={refFor(box.key)}
        style={{ left: box.x, top: box.y, ...(actor.kind === "agent" ? expanded ? expandedSize : standardSize : {}) }}
      >
        <MaterialBody steps={materialSettings.steps} />
        {actor.kind === "script" ? <ScriptActorCard actor={actor}
          state={state} stateLabel={STATE_WORDS[state]} inputCount={inputCount}
          onSelect={() => onSelect({ type: "actor", id: actor.id })} /> : <div className={cn(materialHeadClass, "min-h-[40px] flex-none",
          actor.kind === "agent" && "-mr-[22px] pr-[34px]",
          "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:left-3 after:border-t after:border-[#51465738] after:content-['']")}>
        <button
          className="flex w-full cursor-pointer items-center gap-2 rounded-[16px] p-0 text-left"
          onClick={() => onSelect({ type: "actor", id: actor.id })}
          title={cardTitle(actor, state, inputCount)}
          type="button"
        >
          <span className={`${materialIconClass} [&>svg]:size-5`} data-state={state}>
            {actor.kind === "agent" && state === "running"
              ? <WorkingScenes compact label={`@${actor.handle} arbeitet`} />
              : <RoleIcon role={roleOf(view, actor)} />}
          </span>
          <span className={materialTitleClass}>@{actor.handle}</span>
        </button>
        {actor.kind === "agent" && <Button className="shrink-0 self-center" size="icon-sm" variant="ghost"
          aria-label={`Karte von @${actor.handle} ${expanded ? "kompakt anzeigen" : "vergrößern"}`} title={`Karte von @${actor.handle} ${expanded ? "kompakt anzeigen" : "vergrößern"}`}
          aria-pressed={expanded}
          onClick={() => {
            resizeSession.current?.cancel();
            setExpandedActors((current) => {
              const next = new Set(current);
              if (expanded) next.delete(actor.id); else next.add(actor.id);
              return next;
            });
          }}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d={expanded ? "M3 9h6V3m12 12h-6v6M9 9 3 3m12 12 6 6" : "M9 3H3v6m12 12h6v-6M3 3l6 6m12 12-6-6"} />
          </svg>
        </Button>}
        </div>}
        {actor.kind === "agent" && <ActorChatPreview actor={actor} view={view} running={state === "running"}
          conversation={session.actorConversations?.[actor.id]} historyError={session.conversationError}
          onNavigate={onSelect}
          primaryMessages={actor.id === view.primaryActorId ? session.messages : undefined} />}
        <div className={cn(cardSectionsClass, actor.kind === "agent" && "max-h-[45%] flex-[0_1_auto] overflow-auto",
          actor.kind === "script" && "mx-3 mb-2 border-t px-0 pt-2 pb-0")} data-slot="card-sections">
          {cardSections.map(({ id, Section }) => (
            <Section actor={actor} key={id} navigation={navigation} session={session} />
          ))}
        </div>
        {actor.kind === "agent" && <button className={resizeHandleClass} type="button"
          aria-label={`Größe der Karte von @${actor.handle} ändern`} title="Kartengröße ziehen"
          onPointerDown={(event) => startResize(event, {
            key: `actor:${actor.id}`,
            limits: ACTOR_CARD_SIZE_LIMITS,
            onCommit: saveSize,
          })} />}
      </div>
    );
  };

  const renderApp = (box: PlacedBox) => {
    const current = elementByKey.get(box.key);
    if (!current) return null;
    const Element = current.contribution.Element;
    return (
      <div
        className={materialCardClass("app", cn("absolute flex min-h-0 min-w-0 overflow-visible [&>*:not(svg)]:min-h-0 [&>*:not(svg)]:min-w-0 [&>*:not(svg)]:w-full [&>*:not(svg)]:flex-1",
          current.definition.resizable && "pb-[22px]"))}
        data-surface="material"
        data-canvas-card="true"
        data-resizable={current.definition.resizable ? "true" : undefined}
        data-canvas-entity-type={current.definition.entity?.type}
        data-canvas-navigation-id={box.key}
        data-canvas-entity-id={current.definition.entity?.id}
        key={box.key}
        ref={refFor(box.key)}
        style={{ left: box.x, top: box.y, width: current.definition.width, height: current.definition.height }}
      >
        <MaterialBody steps={materialSettings.steps} />
        <Element
          collapsed={collapsedElements.has(current.layoutKey)}
          definition={current.definition}
          onCollapsedChange={current.definition.collapsedHeight === undefined ? undefined : (collapsed) => {
            resizeSession.current?.cancel();
            setCollapsedElements((previous) => {
              const next = new Set(previous);
              if (collapsed) next.add(current.layoutKey);
              else next.delete(current.layoutKey);
              return next;
            });
          }}
          navigation={navigation}
          session={session}
        />
        {current.definition.resizable && !collapsedElements.has(current.layoutKey) && (
          <button
            aria-label="Canvas-App skalieren"
            className={resizeHandleClass}
            onPointerDown={(event) => startResize(event, {
              key: current.layoutKey, limits: current.definition.resizable!,
              onCommit: (size) => setCanvasSizes((previous) => new Map(previous).set(current.layoutKey, size)),
            })}
            title="Größe ändern"
            type="button"
          />
        )}
      </div>
    );
  };

  return (
    <>
      <div inert={onOverviewTarget !== undefined}>
      <svg aria-label="Linien" className="pointer-events-none absolute top-0 left-0 overflow-visible" height="4" role="group" width="4">
        {scene.lines.map((line) => {
          const from = boxes.get(line.fromKey);
          const to = boxes.get(line.toKey);
          const fromInfo = scene.leaves.get(line.fromKey);
          const toInfo = scene.leaves.get(line.toKey);
          if (!from || !to || !fromInfo || !toInfo) return null;
          const geometry = lineGeometry({ box: from, boundary: boundaryOf(fromInfo) }, { box: to, boundary: boundaryOf(toInfo) });
          const touched = line.fromKey === focusKey || line.toKey === focusKey;
          return (
            <g className={lineClass(touched)} key={line.key}>
              <SvgEdge
                d={`M ${geometry.x1.toFixed(1)} ${geometry.y1.toFixed(1)} L ${geometry.x2.toFixed(1)} ${geometry.y2.toFixed(1)}`}
                arrow={line.arrow} lineStyle={line.style} tone={focusKey !== undefined && touched ? "accent" : "neutral"}
              />
              {line.label?.trim() && (
                <text className="fill-muted-foreground stroke-canvas stroke-[4px] font-mono text-[11px] font-bold [dominant-baseline:central] [paint-order:stroke]" ref={refFor(`label:${line.key}`)} textAnchor="middle" x={geometry.middle.x} y={geometry.middle.y}>
                  {line.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {placed.frames.map((frame) => (
        <div
          className={cn("pointer-events-none absolute", frame.outline && "rounded-xl border border-glass-edge bg-glass-group")}
          key={frame.key}
          style={{ left: frame.x, top: frame.y - materialDepth * .7, width: frame.width + materialDepth * .5, height: frame.height + materialDepth * .7 }}
        >
          {frame.label && <span className={cn("absolute whitespace-nowrap text-[0.66rem] font-bold tracking-[0.07em] uppercase text-muted-foreground", frame.outline ? "top-1.5 left-3.5" : "top-[3px] left-0")}>{frame.label}</span>}
        </div>
      ))}
      {placed.boxes.map((box) => {
        const info = scene.leaves.get(box.key);
        if (!info) return null;
        switch (info.type) {
          case "actor":
            return renderActor(info.actor, box);
          case "app":
            return renderApp(box);
          case "shape":
            return (
              <div
                className="absolute grid place-items-center text-center text-foreground [&>svg]:absolute [&>svg]:inset-0 [&>svg]:fill-card [&>svg]:stroke-border-strong [&>svg]:stroke-1"
                data-canvas-navigation-id={box.key}
                key={box.key}
                style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
                title={info.shape.text}
              >
                <ShapeOutline box={box} shape={info.shape} />
                <span className={cn("relative overflow-hidden text-xs font-semibold leading-[1.25] [overflow-wrap:anywhere]",
                  info.shape.kind === "circle" ? "max-h-[68%] max-w-[68%]" : "max-h-[48%] max-w-[48%]")}>{info.shape.text}</span>
              </div>
            );
          case "missing":
            return (
              <div
                className="absolute grid place-items-center rounded-lg border border-dotted border-border-strong font-mono text-xs font-bold text-muted-foreground"
                key={box.key}
                style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
                title="Diese Entität gibt es auf der Fläche nicht"
              >
                {info.reference}
              </div>
            );
        }
      })}
      {scene.notices.length > 0 && (
        <Card className="absolute gap-1 border-border-strong px-3.5 py-3 text-xs leading-[18px] text-foreground shadow-card [&>div]:before:font-bold [&>div]:before:content-['!_']" role="status" style={{ left: originX, top: noticeTop, width: NOTICE_WIDTH }}>
          {scene.notices.map((notice) => <div key={notice}>{notice}</div>)}
        </Card>
      )}
      </div>
      {onOverviewTarget && placed.boxes.map((box) => {
        const info = scene.leaves.get(box.key);
        if (!info || info.type === "missing") return null;
        const label = info.type === "actor" ? `@${info.actor.handle}`
          : info.type === "shape" ? info.shape.text
          : elementByKey.get(box.key)?.definition.title ?? "Mini-App";
        return <button
          aria-label={`${label} bei 100 Prozent zentrieren`}
          className="absolute z-20 m-0 cursor-zoom-in touch-manipulation rounded-lg bg-transparent p-0 hover:bg-primary/12 hover:outline-[length:calc(3px/var(--cam-zoom,1))] hover:outline-primary hover:outline-offset-[calc(3px/var(--cam-zoom,1))] focus-visible:bg-primary/12 focus-visible:outline-[length:calc(3px/var(--cam-zoom,1))] focus-visible:outline-primary focus-visible:outline-offset-[calc(3px/var(--cam-zoom,1))]"
          key={box.key}
          onClick={() => onOverviewTarget({ left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height })}
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
          title={label}
          type="button"
        />;
      })}
    </>
  );
}
