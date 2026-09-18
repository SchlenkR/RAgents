import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CodeXml, LayoutGrid, Sparkles, GripVertical, X } from "lucide-react";
import { canvasTileNodeOf, type CanvasTileNode } from "../tiled-layout";
import { CANVAS_TILE_DRAG_TYPE, dockTile, removeTile, resizeTile, tileEntities, tileGeometry, tileMinimum, type TileDivider, type TileDockSide, type TileRect } from "./tile-docking";
import { MaterialBody, materialCardClass, materialHeadClass, materialIconClass, materialTitleClass } from "./MaterialBody";

export interface CanvasTileItem { entity: string; title: string; content: ReactNode; surface?: "agent" | "primary" | "script" | "app" }
interface TiledCanvasProps {
  root: CanvasTileNode | null;
  onChange: (root: CanvasTileNode | null) => void;
  items: readonly CanvasTileItem[];
  canArrange: boolean;
  selectedEntity?: string;
  onSelect?: (entity: string) => void;
}
interface DockTarget { entity: string | null; side: TileDockSide }
const sides: readonly TileDockSide[] = ["left", "right", "top", "bottom"];
const sideNames = { left: "Links andocken", right: "Rechts andocken", top: "Oben andocken", bottom: "Unten andocken" };
const sideIcons = { left: ArrowLeft, right: ArrowRight, top: ArrowUp, bottom: ArrowDown };
const materialFaceRect = (slot: TileRect): TileRect => ({
  left: slot.left + 2,
  top: slot.top + 2,
  width: Math.max(0, slot.width - 4),
  height: Math.max(0, slot.height - 4),
});
const positioned = (rect: TileRect): CSSProperties => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
const sidePlacement = {
  left: { inner: "left-0 top-[40px]", outer: "left-0 top-[calc(50%_-_18px)]" },
  right: { inner: "right-0 top-[40px]", outer: "right-0 top-[calc(50%_-_18px)]" },
  top: { inner: "top-0 left-[40px]", outer: "top-0 left-[calc(50%_-_18px)]" },
  bottom: { inner: "bottom-0 left-[40px]", outer: "bottom-0 left-[calc(50%_-_18px)]" },
};
const dockTargetClass = "absolute grid size-[36px] place-items-center rounded-[5px] border border-primary bg-canvas text-primary shadow-[0_2px_8px_#0002] pointer-events-auto data-[active]:bg-primary data-[active]:text-canvas [&>svg]:pointer-events-none";
const dividerClass = "absolute z-3 grid touch-none place-items-center rounded-[4px] focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2 data-[direction=horizontal]:cursor-col-resize data-[direction=vertical]:cursor-row-resize [&>span]:pointer-events-none [&>span]:rounded-[4px] [&>span]:bg-border-strong data-[direction=horizontal]:[&>span]:h-8 data-[direction=horizontal]:[&>span]:w-[3px] data-[direction=vertical]:[&>span]:h-[3px] data-[direction=vertical]:[&>span]:w-8 hover:[&>span]:bg-primary focus-visible:[&>span]:bg-primary";

export function TiledCanvas({ root, onChange, items, canArrange, selectedEntity, onSelect }: TiledCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [dragEntity, setDragEntity] = useState<string | null>(null);
  const [target, setTarget] = useState<DockTarget | null>(null);
  const [resizing, setResizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>();
  const [resizePreview, setResizePreview] = useState<CanvasTileNode | null>(null);
  const resizeFrame = useRef<number | null>(null);
  const resizeRef = useRef<{ divider: TileDivider; start: number; root: CanvasTileNode; next: CanvasTileNode; pointerId: number; handle: HTMLDivElement } | null>(null);
  const visibleRoot = resizePreview ?? root;
  const entities = useMemo(() => tileEntities(root), [root]);
  const mountedEntities = useMemo(() => [...entities].sort(), [entities]);
  const itemMap = useMemo(() => new Map(items.map((item) => [item.entity, item])), [items]);
  const minimum = root ? tileMinimum(root) : { width: 0, height: 0 };
  const compact = available.width < minimum.width || available.height < minimum.height;
  const active = selected && entities.includes(selected) ? selected : entities[0];
  const rect = { left: 0, top: 0, ...size };
  const geometry = useMemo(() => visibleRoot ? tileGeometry(visibleRoot, { left: 0, top: 0, ...size }) : { leaves: new Map<string, TileRect>(), dividers: [] }, [visibleRoot, size]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const container = stage.parentElement!;
    const measure = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
      const style = getComputedStyle(container);
      const availableWidth = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const availableHeight = container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      setAvailable((previous) => previous.width === availableWidth && previous.height === availableHeight
        ? previous : { width: availableWidth, height: availableHeight });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    observer.observe(container);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => { if (selectedEntity) setSelected(selectedEntity); }, [selectedEntity]);
  useLayoutEffect(() => {
    if (!canArrange) { setDragEntity(null); setTarget(null); return; }
    let pendingFrame: number | null = null;
    const cancelActivation = () => {
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
    };
    const start = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(CANVAS_TILE_DRAG_TYPE)) return;
      const entity = event.dataTransfer.getData(CANVAS_TILE_DRAG_TYPE);
      if (!entity) return;
      cancelActivation();
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null;
        if (!event.defaultPrevented) setDragEntity(entity);
      });
    };
    const end = () => { cancelActivation(); setDragEntity(null); setTarget(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") end(); };
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    window.addEventListener("keydown", key);
    return () => {
      cancelActivation();
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
      window.removeEventListener("keydown", key);
    };
  }, [canArrange]);

  const cancelResize = useCallback(() => {
    if (resizeFrame.current !== null) cancelAnimationFrame(resizeFrame.current);
    resizeFrame.current = null;
    const state = resizeRef.current;
    resizeRef.current = null;
    if (state?.handle.hasPointerCapture(state.pointerId)) state.handle.releasePointerCapture(state.pointerId);
    setResizePreview(null);
    setResizing(false);
  }, []);

  useLayoutEffect(() => {
    cancelResize();
    return cancelResize;
  }, [root, size, compact, cancelResize]);

  useEffect(() => {
    if (!resizing) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancelResize(); };
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancelResize);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancelResize);
    };
  }, [resizing, cancelResize]);

  const updateResize = (event: { pointerId: number; clientX: number; clientY: number }) => {
    const state = resizeRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const coordinate = state.divider.direction === "horizontal" ? event.clientX : event.clientY;
    const ratio = Math.max(state.divider.minimum, Math.min(state.divider.maximum,
      state.divider.ratio + (coordinate - state.start) / state.divider.span));
    state.next = coordinate === state.start ? state.root : resizeTile(state.root, state.divider.path, ratio);
  };

  const select = (entity: string) => { setSelected(entity); onSelect?.(entity); };
  const previewRoot = canArrange && target && dragEntity ? dockTile(root, dragEntity, target.entity, target.side) : null;
  const previewMinimum = previewRoot ? tileMinimum(previewRoot) : null;
  const preview = previewRoot && previewRoot !== root && previewMinimum && dragEntity
    ? available.width < previewMinimum.width || available.height < previewMinimum.height
      ? rect
      : tileGeometry(previewRoot, rect).leaves.get(dragEntity)
    : null;

  const targets = (entity: string | null) => sides.map((side) => {
    const Icon = sideIcons[side];
    return <div key={side} className={`${dockTargetClass} ${sidePlacement[side][entity === null ? "outer" : "inner"]}`}
      data-dock-side={side} data-dock-entity={entity ?? ""} title={sideNames[side]}
      data-active={target?.entity === entity && target.side === side || undefined}>
      <Icon size={18} aria-hidden="true" />
    </div>;
  });

  return <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2 data-[dragging]:[&_iframe]:pointer-events-none data-[resizing]:[&_iframe]:pointer-events-none"
    data-dragging={canArrange && dragEntity !== null || undefined} data-resizing={resizing || undefined}>
    {compact && entities.length > 1 && <label className="flex items-center gap-2 pb-2 text-[0.8rem]">Kachel
      <select className="max-w-[60%] min-w-0" aria-label="Sichtbare Kachel" value={active} onChange={(event) => select(event.target.value)}>
        {entities.map((entity) => <option key={entity} value={entity}>{itemMap.get(entity)?.title ?? entity}</option>)}
      </select>
      <span className="truncate text-muted-foreground">Mehr Platz für die geteilte Ansicht benötigt</span>
    </label>}
    <div ref={stageRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
      onDragOver={(event) => {
        if (!canArrange || dragEntity === null || !event.dataTransfer.types.includes(CANVAS_TILE_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const element = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-dock-side]") : null;
        const next = element && stageRef.current?.contains(element)
          ? { entity: element.dataset.dockEntity || null, side: element.dataset.dockSide as TileDockSide } : null;
        setTarget((previous) => previous?.entity === next?.entity && previous?.side === next?.side ? previous : next);
      }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(null); }}
      onDrop={(event) => {
        if (!canArrange || dragEntity === null) return;
        const entity = event.dataTransfer.getData(CANVAS_TILE_DRAG_TYPE);
        if (!entity || entity !== dragEntity) return;
        event.preventDefault();
        if (!itemMap.has(entity) && !entities.includes(entity)) return;
        const element = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-dock-side]") : null;
        try {
          if (!root || element) {
            const next = dockTile(root, entity, element?.dataset.dockEntity || null, (element?.dataset.dockSide ?? "right") as TileDockSide);
            if (next !== root) onChange(next === null ? null : canvasTileNodeOf(next));
            select(entity);
            setError(null);
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setDragEntity(null);
          setTarget(null);
        }
      }}>
      {error && <div className="absolute inset-x-2 bottom-2 z-7 flex items-center gap-2 rounded-lg border border-primary bg-canvas p-3 text-foreground shadow-[0_2px_8px_#0002]" role="alert"><span className="flex-1">{error}</span><button className="grid cursor-pointer place-items-center bg-transparent p-1" type="button" aria-label="Meldung schließen" onClick={() => setError(null)}><X size={16} /></button></div>}
      {!root && <div className="grid h-full place-items-center rounded-lg border border-dashed border-border-strong p-6 text-center text-muted-foreground">{canArrange ? "Ziehe einen Actor oder eine Mini-App aus der Kopfzeile hierher." : "Für diese Kachelansicht sind noch keine Inhalte angeordnet."}</div>}
      {mountedEntities.map((entity) => {
        const item = itemMap.get(entity);
        const bounds = materialFaceRect(compact ? rect : geometry.leaves.get(entity)!);
        return <section key={entity} className={materialCardClass(item?.surface ?? (entity.startsWith("app:") ? "app" : "agent"),
          "absolute z-0 flex min-h-0 min-w-0 flex-col overflow-visible")} data-tile-entity={entity} data-surface="material"
          style={{ ...positioned(bounds), display: compact && entity !== active ? "none" : undefined }}
          onFocusCapture={() => { if (active !== entity) setSelected(entity); }}>
          <MaterialBody steps={0} />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[15.5px]">
            <header className={`${materialHeadClass} flex-[0_0_49px] min-w-0 select-none border-b border-[#51465738] text-foreground [&[draggable=true]]:cursor-grab`}
              draggable={canArrange} onDragStart={(event) => {
              if (!canArrange) { event.preventDefault(); return; }
              event.dataTransfer.setData(CANVAS_TILE_DRAG_TYPE, entity);
              event.dataTransfer.effectAllowed = "move";
            }}>
              {canArrange && <GripVertical size={16} aria-hidden="true" />}
              <span className={materialIconClass}>{item?.surface === "app" || entity.startsWith("app:") ? <LayoutGrid size={20} aria-hidden="true" /> : item?.surface === "script" ? <CodeXml size={20} aria-hidden="true" /> : <Sparkles size={20} aria-hidden="true" />}</span>
              <span className={`${materialTitleClass} flex-1`} title={item?.title ?? entity}>{item?.title ?? entity}</span>
              {canArrange && <button className="grid size-[26px] cursor-pointer place-items-center rounded-[4px] bg-transparent p-0 text-muted-foreground hover:bg-glass-group hover:text-foreground"
                type="button" draggable={false} aria-label={`Kachel ${item?.title ?? entity} entfernen`}
                onClick={() => onChange(removeTile(root, entity))}><X size={16} /></button>}
            </header>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto [&>*]:min-h-0 [&>*]:min-w-0 [&>*]:flex-1">{item?.content ?? <div className="p-4.5 text-muted-foreground">{canArrange ? "Dieser Inhalt ist nicht mehr verfügbar. Du kannst die Kachel entfernen oder einen anderen Inhalt hier andocken." : "Dieser Inhalt ist nicht mehr verfügbar."}</div>}</div>
          </div>
          {canArrange && dragEntity !== null && dragEntity !== entity && <div className="absolute inset-0 z-4"><div className="pointer-events-none absolute top-1/2 left-1/2 size-[116px] -translate-x-1/2 -translate-y-1/2">{targets(entity)}</div></div>}
        </section>;
      })}
      {!compact && geometry.dividers.map((divider) => <div key={divider.path.join(".")} className={dividerClass}
        role="separator" tabIndex={0} aria-label="Kachelgröße ändern"
        aria-orientation={divider.direction === "horizontal" ? "vertical" : "horizontal"}
        aria-valuemin={Math.round(divider.minimum * 100)} aria-valuemax={Math.round(divider.maximum * 100)} aria-valuenow={Math.round(divider.ratio * 100)}
        data-direction={divider.direction} style={positioned(divider)}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary || !root || resizeRef.current) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeRef.current = { divider, start: divider.direction === "horizontal" ? event.clientX : event.clientY, root, next: root, pointerId: event.pointerId, handle: event.currentTarget };
          setResizing(true);
        }}
        onPointerMove={(event) => {
          if (resizeRef.current?.pointerId !== event.pointerId) return;
          updateResize(event);
          if (resizeFrame.current !== null) return;
          resizeFrame.current = requestAnimationFrame(() => {
            resizeFrame.current = null;
            if (resizeRef.current) setResizePreview(resizeRef.current.next);
          });
        }}
        onPointerUp={(event) => {
          const state = resizeRef.current;
          if (!state || state.pointerId !== event.pointerId) return;
          updateResize(event);
          cancelResize();
          if (state.next !== state.root) onChange(state.next);
        }}
        onLostPointerCapture={(event) => { if (resizeRef.current?.pointerId === event.pointerId) cancelResize(); }}
        onPointerCancel={(event) => { if (resizeRef.current?.pointerId === event.pointerId) cancelResize(); }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && resizeRef.current) { event.preventDefault(); cancelResize(); return; }
          if (!root || resizeRef.current) return;
          const negative = divider.direction === "horizontal" ? "ArrowLeft" : "ArrowUp";
          const positive = divider.direction === "horizontal" ? "ArrowRight" : "ArrowDown";
          if (event.key !== negative && event.key !== positive && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          const ratio = event.key === "Home" ? divider.minimum : event.key === "End" ? divider.maximum : divider.ratio + (event.key === positive ? 0.02 : -0.02);
          onChange(resizeTile(root, divider.path, Math.max(divider.minimum, Math.min(divider.maximum, ratio))));
        }}><span /></div>)}
      {resizing && <div className="absolute inset-0 z-2" />}
      {canArrange && dragEntity !== null && root && <div className="pointer-events-none absolute inset-2 z-6">{targets(null)}</div>}
      {canArrange && dragEntity !== null && preview && <div className={materialCardClass(itemMap.get(dragEntity)?.surface ?? (dragEntity.startsWith("app:") ? "app" : "agent"),
        "pointer-events-none absolute z-5 opacity-80")}
        style={positioned(materialFaceRect(preview))}><MaterialBody steps={0} /><div className="absolute inset-0 rounded-[15.5px] border-2 border-primary bg-primary/22" /></div>}
    </div>
  </div>;
}
