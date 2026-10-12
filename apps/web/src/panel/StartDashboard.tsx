import type { JsonValue } from "@ragents/engine/src/domain/json";
import { cn } from "cn";
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, PencilIcon, PlusIcon, RotateCcwIcon, SettingsIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createLocalStorageSetting } from "../lib/local-storage-setting";
import { usePointerDrag, type PointerPoint } from "../lib/pointer-drag";
import type { StartWidgetSettings, StartWidgetSettingValues } from "../PluginRegistry";
import type { PreferenceStore } from "../preferences";
import { RenderBoundary } from "../RenderBoundary";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui";
import { OverflowTabs, OverflowTabsList } from "../ui/overflow-tabs";
import { SectionHeading } from "../ui/SectionLabel";
import {
  DASHBOARD_COLUMNS, DASHBOARD_TABS_BELOW, dashboardLayout, draggedColumns, dropPlace, packWidgets, resizedColumns, shownColumns, type WidgetBox, type WidgetWidth,
} from "./dashboard-layout";
import {
  addWidget, arrangeWidgets, configureWidget, DEFAULT_DASHBOARD_PREFERENCES, draftOf, isDefaultLayout, moveWidget, preferencesOf, readDashboardLayout, removeWidget,
  resizeWidget, writeDashboardLayout, type DashboardDraft, type DashboardPreferences, type StoredDashboardLayout,
} from "./dashboard-preferences";
import { NO_SETTINGS, storedSettingsOf, widgetSettingsOf, type ResolvedWidgetSettings } from "./widget-settings";
import { WidgetSettingsDialog } from "./WidgetSettingsDialog";

/** One area of Start, from any Start widget; its width counts columns of the six-column grid, and edit mode offers the range. */
export interface DashboardWidget extends WidgetWidth {
  /** Stable across sessions, because the viewer's layout refers to it. */
  readonly key: string;
  /** Without a title the content owns its heading, fills a row, stays below the tabs, and cannot be arranged. */
  readonly title?: string;
  /** One sentence for the widget gallery of edit mode. */
  readonly description?: string;
  /** What the viewer may configure in edit mode; the content receives the checked values. */
  readonly settings?: StartWidgetSettings;
  readonly content: (settings: StartWidgetSettingValues) => ReactNode;
}

type Item = DashboardWidget & { readonly framed: boolean };
type FramedItem = Item & { readonly title: string };
type Mode = "grid" | "tabs" | "list";
type Control = "handle" | "up" | "down" | "configure";

type LayoutState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly stored: StoredDashboardLayout }
  | { readonly kind: "failed"; readonly message: string };

type Gesture =
  | { readonly kind: "move"; readonly key: string; readonly point: PointerPoint }
  | { readonly kind: "resize"; readonly key: string; readonly columns: number; readonly point: PointerPoint };

/** Where focus goes after the next commit, because moving, removing, and switching modes replace or move the focused control. */
type FocusTarget = { readonly kind: "control"; readonly key: string; readonly control: Control } | { readonly kind: "add" } | { readonly kind: "edit" };

const isFramed = (widget: Item): widget is FramedItem => widget.framed;

/** The grid classes by its number of columns, written out so that Tailwind finds them. */
const GRID_CLASSES: Readonly<Record<number, string>> = { 1: "grid-cols-1", 3: "grid-cols-3", 6: "grid-cols-6" };

const gridClass = (grid: number): string => {
  const name = GRID_CLASSES[grid];
  if (name === undefined) throw new Error(`Start has no grid of ${grid} columns.`);
  return name;
};

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** The key under which the "Add widget" tile packs after the widgets; widget IDs are never empty. */
const ADD_TILE = "";

const REPACK_MOTION = "start-repack";

/** A length of whole columns of the grid: shares of its width less its gaps, plus the gaps between them. */
const columnLength = (grid: number, columns: number, gaps: number): string =>
  `calc((100% - ${grid - 1} * var(--start-gap-x)) / ${grid} * ${columns} + ${gaps} * var(--start-gap-x))`;

/** A packed cell's width in the grid shown; its place comes from packCells. */
const cellWidth = (grid: number, columns: number): CSSProperties => ({ width: columnLength(grid, columns, columns - 1) });

type Motion = "none" | "running" | "rearranged";

/** Packs the cells of a dashboard in grid mode as they are rendered now, in their order with their columns and heights, writes their places and the grid's height, and slides cells that were placed before: all of them after a new arrangement, only those still sliding when heights settle. */
function packCells(element: HTMLElement, motion: Motion) {
  const grid = Number(element.dataset.grid);
  const gap = parseFloat(getComputedStyle(element).rowGap);
  if (!Number.isInteger(grid) || !Number.isFinite(gap)) throw new Error("Start's grid has no columns or row gap to pack its widgets in.");
  const cells = [...element.querySelectorAll<HTMLElement>(":scope > [data-pack]")];
  const before = cells.map((cell) => cell.style.top === "" || cell.offsetParent === null ? undefined : { x: cell.offsetLeft, y: cell.offsetTop });
  const packing = packWidgets(cells.map((cell) => {
    const height = parseFloat(getComputedStyle(cell).height);
    // A cell that is not rendered has no height and takes no place.
    return { key: cell.dataset.pack!, columns: Number(cell.dataset.columns), height: Number.isFinite(height) ? height : 0 };
  }), grid, gap);
  const placed = new Map(packing.widgets.map((widget) => [widget.key, widget]));
  for (const cell of cells) {
    const at = placed.get(cell.dataset.pack!);
    cell.style.left = columnLength(grid, at?.column ?? 0, at?.column ?? 0);
    cell.style.top = `${at?.top ?? 0}px`;
  }
  element.style.height = `${packing.height}px`;
  if (motion === "none" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  cells.forEach((cell, index) => {
    const from = before[index];
    if (from === undefined || (from.x === cell.offsetLeft && from.y === cell.offsetTop)) return;
    const running = cell.getAnimations().filter((animation) => animation.id === REPACK_MOTION);
    if (motion === "running" && running.length === 0) return;
    const shown = new DOMMatrixReadOnly(getComputedStyle(cell).transform);
    for (const animation of running) animation.cancel();
    cell.animate([{ transform: `translate(${from.x + shown.m41 - cell.offsetLeft}px, ${from.y + shown.m42 - cell.offsetTop}px)` }, { transform: "none" }],
      { id: REPACK_MOTION, duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" });
  });
}

/** Tabs and the narrow list lay their cells out in flow again. */
function unpackCells(element: HTMLElement) {
  element.style.removeProperty("height");
  for (const cell of element.querySelectorAll<HTMLElement>(":scope > [data-pack]")) {
    cell.style.removeProperty("left");
    cell.style.removeProperty("top");
    for (const animation of cell.getAnimations().filter((running) => running.id === REPACK_MOTION)) animation.cancel();
  }
}

export const startWidgetStorageKey = (origin: string) => `ragents.start.widget:${encodeURIComponent(origin)}`;

/** The tab chosen in a narrow Start belongs to this device, so it stays in the browser storage of the page. */
const chosenWidget = createLocalStorageSetting<string | undefined>({
  changeEvent: "ragents-start-widget-change",
  matchesKey: (key) => key.startsWith("ragents.start.widget:"),
  parse: (raw) => raw ?? undefined,
  serialize: (value) => {
    if (value === undefined) throw new Error("Start can only remember a widget it shows.");
    return value;
  },
});

/** The width of the dashboard itself, so that a narrow VS Code panel counts as narrow on a wide screen; measured on a probe without height, so packing that changes the dashboard's height inside a ResizeObserver callback never notifies this one. */
function useInlineSize(element: HTMLElement | null): number | undefined {
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [element]);
  return width;
}

/** Widgets whose content currently renders nothing; they take neither a cell nor a tab. */
function useEmptyWidgets(element: HTMLElement | null, keys: string): ReadonlySet<string> {
  const [empty, setEmpty] = useState<ReadonlySet<string>>(() => new Set());
  useLayoutEffect(() => {
    if (!element) return;
    const check = () => {
      const next = [...element.querySelectorAll<HTMLElement>("[data-start-widget-body]")]
        .filter((body) => body.childNodes.length === 0)
        .map((body) => body.dataset.startWidgetBody!);
      setEmpty((current) => current.size === next.length && next.every((key) => current.has(key)) ? current : new Set(next));
    };
    const observer = new MutationObserver(check);
    observer.observe(element, { childList: true, subtree: true });
    check();
    return () => observer.disconnect();
  }, [element, keys]);
  return empty;
}

/** Packs the grid after every render and whenever a cell changes its size on its own, both before the browser paints, so a growing widget pushes the ones below without a frame of overlap; the places go straight to the cells, so a ResizeObserver callback renders nothing. */
function usePacking(element: HTMLElement | null, frame: string | undefined, arrangement: string) {
  const packed = useRef<{ readonly frame: string; readonly arrangement: string } | undefined>(undefined);
  useLayoutEffect(() => {
    if (!element) return;
    const before = packed.current;
    packed.current = frame === undefined ? undefined : { frame, arrangement };
    if (frame === undefined) unpackCells(element);
    else packCells(element, before?.frame !== frame ? "none" : before.arrangement !== arrangement ? "rearranged" : "running");
  });
  useLayoutEffect(() => {
    if (!element || frame === undefined) return;
    const observer = new ResizeObserver(() => packCells(element, "running"));
    for (const cell of element.querySelectorAll<HTMLElement>(":scope > [data-pack]")) observer.observe(cell);
    return () => observer.disconnect();
  }, [element, frame, arrangement]);
}

/** The viewer's layout from the server's preference store, read whenever Start opens; without a store Start keeps its default layout. */
function useStoredLayout(preferences: PreferenceStore | undefined) {
  const [state, setState] = useState<LayoutState>(preferences === undefined ? { kind: "ready", stored: { preferences: DEFAULT_DASHBOARD_PREFERENCES } } : { kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (preferences === undefined) return;
    const controller = new AbortController();
    preferences.read("start.layout").then(
      (value) => { if (!controller.signal.aborted) setState({ kind: "ready", stored: readDashboardLayout(value) }); },
      (cause: unknown) => { if (!controller.signal.aborted) setState({ kind: "failed", message: messageOf(cause) }); },
    );
    return () => controller.abort();
  }, [preferences, attempt]);
  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((count) => count + 1);
  }, []);
  return { state, retry, settle: setState };
}

/** The mode indicator above the widgets while Start is edited. */
function EditBar({ list, saving, canReset, onReset, onCancel, onDone }: {
  list: boolean;
  saving: boolean;
  canReset: boolean;
  onReset: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  return <div aria-label="Edit Start" className="grid gap-1 rounded-xl border border-selected-border bg-selected px-3 py-2 text-selected-foreground" role="group">
    <div className="flex flex-wrap items-center gap-2">
      <PencilIcon aria-hidden className="size-4 flex-none" />
      <p className="mr-auto whitespace-nowrap type-item">Editing Start</p>
      <div className="flex flex-wrap items-center gap-1">
        <Button disabled={!canReset || saving} onClick={onReset} size="xs" variant="ghost"><RotateCcwIcon data-icon="inline-start" />Reset layout</Button>
        <Button disabled={saving} onClick={onCancel} size="xs" variant="outline">Cancel</Button>
        <Button disabled={saving} onClick={onDone} size="xs">{saving ? "Saving ..." : "Done"}</Button>
      </div>
    </div>
    <p className="type-meta">{list
      ? "Drag a widget by its handle or use the arrows to change the order, and remove what you do not need."
      : "Drag a widget by its handle to move it and by its right edge to resize it, and remove what you do not need."}</p>
  </div>;
}

/** The title row in edit mode: the drag handle, the title, the width or the move buttons, Configure for a widget with settings, and remove. */
function EditTitleRow({ widget, columns, grid, list, first, last, resizing, hint, onHandleKey, onHandlePointer, onMove, onConfigure, onRemove }: {
  widget: FramedItem;
  columns: number;
  grid: number;
  list: boolean;
  first: boolean;
  last: boolean;
  resizing: boolean;
  hint: string;
  onHandleKey: (event: KeyboardEvent<HTMLElement>) => void;
  onHandlePointer: (event: PointerEvent<HTMLElement>) => void;
  onMove: (step: -1 | 1) => void;
  onConfigure: (() => void) | undefined;
  onRemove: () => void;
}) {
  return <div className={cn("flex min-h-control-xs min-w-0 items-center gap-1", !list && "pr-2")}>
    <Button aria-describedby={hint} aria-label={`Move ${widget.title}`} className="flex-none cursor-grab touch-none text-muted-foreground active:cursor-grabbing" data-control="handle"
      onKeyDown={onHandleKey} onPointerDown={onHandlePointer} size="icon-xs" title="Drag to move" variant="ghost"><GripVerticalIcon /></Button>
    <h2 className="min-w-0 flex-1 truncate type-label text-muted-foreground">{widget.title}</h2>
    {list
      ? <>
        <Button aria-label={`Move ${widget.title} up`} className="flex-none text-muted-foreground" data-control="up" disabled={first} onClick={() => onMove(-1)} size="icon-xs" title="Move up" variant="ghost"><ArrowUpIcon /></Button>
        <Button aria-label={`Move ${widget.title} down`} className="flex-none text-muted-foreground" data-control="down" disabled={last} onClick={() => onMove(1)} size="icon-xs" title="Move down" variant="ghost"><ArrowDownIcon /></Button>
      </>
      : <span className={cn("flex-none type-meta tabular-nums", resizing ? "font-semibold text-primary" : "text-muted-foreground")} data-widget-columns={columns}
        title={`${shownColumns(columns, grid)} of ${grid} columns`}>{shownColumns(columns, grid)} of {grid}</span>}
    {onConfigure !== undefined && <Button aria-label={`Configure ${widget.title}`} className="flex-none text-muted-foreground" data-control="configure" onClick={onConfigure} size="icon-xs"
      title="Configure" variant="ghost"><SettingsIcon /></Button>}
    <Button aria-label={`Remove ${widget.title}`} className="flex-none text-muted-foreground" onClick={onRemove} size="icon-xs" title="Remove from Start" variant="ghost"><XIcon /></Button>
  </div>;
}

/** Calls a widget's content inside its own RenderBoundary, so a content function that throws stays in its cell. */
function WidgetContent({ content, settings }: { content: DashboardWidget["content"]; settings: StartWidgetSettingValues }) {
  return content(settings);
}

/** The host frame of a widget: its title row, the saved settings it could not use, and its body; the body keeps its place in every mode, so the widget's state survives editing. */
function WidgetFrame({ widget, settings, titleRow, editing, list, empty }: {
  widget: FramedItem;
  settings: ResolvedWidgetSettings;
  titleRow: ReactNode;
  editing: boolean;
  list: boolean;
  empty: boolean;
}) {
  return <section aria-label={widget.title} className="grid min-w-0 grid-cols-1 content-start gap-3">
    {titleRow}
    {settings.problems.length > 0 && !list && <p className="type-meta text-destructive [overflow-wrap:anywhere]" data-settings-problem role="alert">{settings.problems.join(" ")}</p>}
    <div className={cn("@container/widget min-w-0", editing && "opacity-60")} data-start-widget-body={widget.key} hidden={list} inert={editing}>
      <RenderBoundary resetKeys={[]} title={`${widget.title} could not be displayed`}><WidgetContent content={widget.content} settings={settings.values} /></RenderBoundary>
    </div>
    {editing && !list && empty && <p className="type-body text-muted-foreground">Nothing to show right now.</p>}
  </section>;
}

/** The usual width of a widget and the range the viewer may choose from, for the gallery. */
const widthDescription = ({ columns, minColumns, maxColumns }: WidgetWidth): string =>
  `Width: ${columns} of ${DASHBOARD_COLUMNS} columns${minColumns < maxColumns ? `, adjustable from ${minColumns} to ${maxColumns}` : ""}`;

/** Every widget that is not on Start, with what it shows and its widths; choosing one adds it at the end. */
function WidgetGallery({ widgets, onAdd, onClose }: { widgets: readonly FramedItem[]; onAdd: (key: string) => void; onClose: () => void }) {
  const prefix = useId();
  return <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open>
    <DialogContent className="gap-3" finalFocus={false} scope="page" size="medium">
      <DialogHeader>
        <DialogTitle>Add widget</DialogTitle>
        <DialogDescription>A widget joins Start at the end in its usual width.</DialogDescription>
      </DialogHeader>
      <DialogBody>
        {widgets.length === 0
          ? <p className="type-body text-muted-foreground">Every widget is already on Start.</p>
          : <ul aria-label="Available widgets" className="grid gap-2">
            {widgets.map((widget) => <li key={widget.key}>
              <button aria-describedby={`${prefix}-${widget.key}`} aria-label={`Add ${widget.title}`}
                className="group/add grid w-full gap-1 rounded-xl border border-border bg-card p-3 text-left shadow-card outline-none hover:border-border-strong hover:bg-[color-mix(in_srgb,var(--card),var(--foreground)_6%)] focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onAdd(widget.key)} type="button">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 type-item [overflow-wrap:anywhere]">{widget.title}</span>
                  <PlusIcon aria-hidden className="size-3.5 flex-none text-muted-foreground group-hover/add:text-primary group-focus-visible/add:text-primary" />
                </span>
                <span className="grid gap-0.5" id={`${prefix}-${widget.key}`}>
                  {widget.description !== undefined && <span className="type-body text-muted-foreground">{widget.description}</span>}
                  <span className="type-meta text-muted-foreground">{widthDescription(widget)}</span>
                </span>
              </button>
            </li>)}
          </ul>}
      </DialogBody>
    </DialogContent>
  </Dialog>;
}

/** Start's widgets in a six-column grid by their widths and the viewer's layout, three columns at medium widths and tabs below the narrow limit of its own width; Edit arranges them in place and saves the layout on the server. */
export function StartDashboard({ widgets, preferences }: { widgets: readonly DashboardWidget[]; preferences: PreferenceStore | undefined }) {
  const { state, retry, settle } = useStoredLayout(preferences);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [probe, setProbe] = useState<HTMLDivElement | null>(null);
  // Edit mode keeps the edited layout as preferences, so a widget that arrives meanwhile takes its place and width there or stays removed.
  const [edited, setEdited] = useState<DashboardPreferences>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [configuring, setConfiguring] = useState<string>();
  const [gesture, setGesture] = useState<Gesture>();
  const [announcement, setAnnouncement] = useState("");
  const [focusTarget, setFocusTarget] = useState<FocusTarget>();
  const pointer = usePointerDrag();
  const width = useInlineSize(probe);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const storageKey = startWidgetStorageKey(origin);
  const remembered = chosenWidget.useValue(storageKey);
  const prefix = useId();
  const hint = `${prefix}-hint`;
  const stored: StoredDashboardLayout = state.kind === "ready" ? state.stored : { preferences: DEFAULT_DASHBOARD_PREFERENCES };
  const items: readonly Item[] = widgets.map((widget) => ({ ...widget, framed: widget.title !== undefined }));
  const itemOf = new Map(items.map((item) => [item.key, item]));
  const titleOf = (key: string) => itemOf.get(key)?.title ?? key;
  const effective = edited ?? stored.preferences;
  const settingsOf = (widget: Item) => widgetSettingsOf(widget.settings ?? NO_SETTINGS, effective.settings.get(widget.key));
  const { shown, removed } = arrangeWidgets(items, effective);
  const draft = edited === undefined ? undefined : draftOf(shown);
  const editing = draft !== undefined;
  const empty = useEmptyWidgets(element, shown.map((widget) => widget.key).join("\u0000"));
  const narrow = width !== undefined && width < DASHBOARD_TABS_BELOW;
  const placed = editing ? shown : shown.filter((widget) => !empty.has(widget.key));
  const framed = placed.filter(isFramed);
  const layout = dashboardLayout(placed, width);
  const mode: Mode = editing ? narrow ? "list" : "grid" : layout.mode;
  const grid = mode === "grid" && layout.mode === "grid" ? layout.grid : 1;
  const active = framed.find((widget) => widget.key === remembered)?.key ?? framed[0]?.key ?? "";
  const tabId = (key: string) => `${prefix}-tab-${encodeURIComponent(key)}`;
  const panelId = (key: string) => `${prefix}-panel-${encodeURIComponent(key)}`;
  const span = (key: string) => layout.mode === "grid" ? layout.columns.get(key) ?? grid : grid;
  const widthText = (columns: number) => `${shownColumns(columns, grid)} of ${grid} columns`;
  const arrangement = [...placed.map((widget) => `${widget.key}:${span(widget.key)}`), ...editing ? [`${ADD_TILE}:${shownColumns(2, grid)}`] : []].join("\u0000");
  usePacking(element, mode === "grid" ? `${state.kind}:${grid}` : undefined, arrangement);
  const cellStyle = (key: string): CSSProperties | undefined => mode === "grid" ? cellWidth(grid, span(key)) : undefined;
  const configured = editing ? shown.filter(isFramed).find((widget) => widget.key === configuring) : undefined;

  const leave = useCallback((message: string) => {
    setEdited(undefined);
    setGesture(undefined);
    setGalleryOpen(false);
    setConfiguring(undefined);
    setSaveError(undefined);
    setAnnouncement(message);
    setFocusTarget({ kind: "edit" });
  }, []);
  const cancel = useCallback(() => leave("Changes discarded."), [leave]);

  useEffect(() => {
    if (!editing || galleryOpen || configuring !== undefined || saving) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest("[role=dialog],[role=menu]")) return;
      event.preventDefault();
      cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel, configuring, editing, galleryOpen, saving]);

  useLayoutEffect(() => {
    if (focusTarget === undefined || root === null) return;
    const control = (key: string, name: Control) => root.querySelector<HTMLButtonElement>(`[data-start-widget="${CSS.escape(key)}"] [data-control="${name}"]`);
    const target = focusTarget.kind === "edit" ? root.querySelector<HTMLElement>("[data-edit-start]")
      : focusTarget.kind === "add" ? root.querySelector<HTMLElement>("[data-add-widget]")
        : [control(focusTarget.key, focusTarget.control), control(focusTarget.key, "handle")].find((button) => button !== null && !button.disabled);
    target?.focus();
    setFocusTarget(undefined);
  }, [focusTarget, root]);

  const startEditing = () => {
    if (state.kind !== "ready") return;
    const initial = draftOf(arrangeWidgets(items, stored.preferences).shown);
    setEdited(stored.preferences);
    setSaveError(undefined);
    setAnnouncement("Editing Start. Done saves the layout, Cancel or Escape discards the changes.");
    setFocusTarget(initial[0] === undefined ? { kind: "add" } : { kind: "control", key: initial[0].key, control: "handle" });
  };
  const change = (next: DashboardDraft, message: string, focus?: FocusTarget) => {
    setEdited((current) => current && preferencesOf(next, items, current));
    setAnnouncement(message);
    if (focus !== undefined) setFocusTarget(focus);
  };
  const move = (key: string, step: -1 | 1, control: Control) => {
    if (draft === undefined) return;
    const to = draft.findIndex((widget) => widget.key === key) + step;
    if (to < 0 || to >= draft.length) setAnnouncement(`${titleOf(key)} is already ${step < 0 ? "first" : "last"}.`);
    else change(moveWidget(draft, key, to), `${titleOf(key)} moved to place ${to + 1} of ${draft.length}.`, { kind: "control", key, control });
  };
  const resize = (key: string, step: -1 | 1) => {
    if (draft === undefined) return;
    if (mode === "list") {
      setAnnouncement("Widths are chosen on a wider Start.");
      return;
    }
    const item = itemOf.get(key)!;
    const current = draft.find((widget) => widget.key === key)!.columns;
    const next = resizedColumns({ ...item, columns: current }, shownColumns(current, grid) + step, grid);
    if (next === current) setAnnouncement(`${titleOf(key)} is already at its ${step > 0 ? "widest" : "narrowest"}.`);
    else change(resizeWidget(draft, key, next, item), `${titleOf(key)} is now ${widthText(next)} wide.`, { kind: "control", key, control: "handle" });
  };
  const remove = (key: string) => {
    if (draft === undefined) return;
    const index = draft.findIndex((widget) => widget.key === key);
    const next = removeWidget(draft, key);
    const neighbor = next[index] ?? next[index - 1];
    change(next, `${titleOf(key)} removed from Start.`, neighbor === undefined ? { kind: "add" } : { kind: "control", key: neighbor.key, control: "handle" });
  };
  const add = (key: string) => {
    if (draft === undefined) return;
    setGalleryOpen(false);
    change(addWidget(draft, itemOf.get(key)!), `${titleOf(key)} added at the end.`, { kind: "control", key, control: "handle" });
  };
  const configure = (key: string, values: Readonly<Record<string, JsonValue>>) => {
    const settings = itemOf.get(key)?.settings;
    setConfiguring(undefined);
    setFocusTarget({ kind: "control", key, control: "configure" });
    if (settings === undefined) return;
    setEdited((current) => current && configureWidget(current, key, storedSettingsOf(settings, values)));
    setAnnouncement(`${titleOf(key)} settings applied; Done saves them.`);
  };
  const reset = () => {
    setEdited((current) => current && DEFAULT_DASHBOARD_PREFERENCES);
    setAnnouncement("Start shows its default layout and settings again; Done saves them.");
  };
  const done = () => {
    if (!editing || preferences === undefined) return;
    const next = preferencesOf(draft, items, effective);
    setSaving(true);
    setSaveError(undefined);
    preferences.write("start.layout", writeDashboardLayout(next)).then(() => {
      setSaving(false);
      settle({ kind: "ready", stored: { preferences: next } });
      leave("Start layout saved.");
    }, (cause: unknown) => {
      setSaving(false);
      setSaveError(`The layout could not be saved: ${messageOf(cause)}`);
    });
  };
  const onHandleKey = (event: KeyboardEvent<HTMLElement>, key: string) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      remove(key);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const later = event.key === "ArrowRight" || event.key === "ArrowDown";
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) resize(key, later ? 1 : -1);
    else move(key, later ? 1 : -1, "handle");
  };
  const startMove = (event: PointerEvent<HTMLElement>, key: string) => {
    if (draft === undefined || element === null || event.button !== 0) return;
    const start = draft;
    const known = items;
    const base = effective;
    const from = start.findIndex((widget) => widget.key === key);
    const cells = () => [...element.querySelectorAll<HTMLElement>(":scope > [data-start-widget]")];
    const boxOf = (cell: HTMLElement, box: string): WidgetBox => ({ key: box, left: cell.offsetLeft, top: cell.offsetTop, width: cell.offsetWidth, height: cell.offsetHeight });
    const target = (point: PointerPoint) => {
      const bounds = element.getBoundingClientRect();
      // Pointer positions are in the page's zoomed pixels, the boxes of the cells in CSS pixels of the grid without a slide in progress.
      const zoom = bounds.width / element.offsetWidth || 1;
      const add = element.querySelector<HTMLElement>(":scope > [data-add-widget]");
      return dropPlace(cells().map((cell) => boxOf(cell, cell.dataset.startWidget!)), key, { x: (point.x - bounds.left) / zoom, y: (point.y - bounds.top) / zoom },
        element.clientWidth, add === null ? undefined : boxOf(add, ADD_TILE));
    };
    const current = () => cells().findIndex((cell) => cell.dataset.startWidget === key);
    const place = (to: number) => setEdited((preferences) => preferences && preferencesOf(moveWidget(start, key, to), known, base));
    // Each new place renders at once, so the next pointer event measures the grid that shows it.
    const follow = (point: PointerPoint) => {
      const to = target(point);
      if (to !== undefined && to !== current()) flushSync(() => place(to));
    };
    pointer(event, (point) => {
      follow(point);
      setGesture({ kind: "move", key, point });
    }, (point) => {
      if (point !== null) follow(point);
      const to = point === null ? from : current();
      setGesture(undefined);
      place(to);
      if (point === null) setAnnouncement(`Moving ${titleOf(key)} was cancelled.`);
      else if (to !== from) setAnnouncement(`${titleOf(key)} moved to place ${to + 1} of ${start.length}.`);
      setFocusTarget({ kind: "control", key, control: "handle" });
    }, element);
    setGesture({ kind: "move", key, point: { x: event.clientX, y: event.clientY } });
  };
  const startResize = (event: PointerEvent<HTMLElement>, key: string) => {
    if (draft === undefined || element === null || event.button !== 0) return;
    const start = draft;
    const known = items;
    const base = effective;
    const item = itemOf.get(key)!;
    const from = start.find((widget) => widget.key === key)!.columns;
    const startX = event.clientX;
    const bounds = element.getBoundingClientRect();
    // Pointer positions and the grid's box are both in the page's zoomed pixels, its gap in CSS pixels.
    const zoom = bounds.width / element.offsetWidth || 1;
    const pitch = (bounds.width + parseFloat(getComputedStyle(element).columnGap) * zoom) / grid;
    const columnsAt = (point: PointerPoint) => draggedColumns({ ...item, columns: from }, grid, point.x - startX, pitch);
    const size = (columns: number) => setEdited((current) => current && preferencesOf(resizeWidget(start, key, columns, item), known, base));
    pointer(event, (point) => {
      const columns = columnsAt(point);
      size(columns);
      setGesture({ kind: "resize", key, columns, point });
    }, (point) => {
      const columns = point === null ? from : columnsAt(point);
      setGesture(undefined);
      size(columns);
      setAnnouncement(point === null ? `Resizing ${titleOf(key)} was cancelled.` : `${titleOf(key)} is now ${widthText(columns)} wide.`);
    }, element);
    setGesture({ kind: "resize", key, columns: from, point: { x: event.clientX, y: event.clientY } });
  };

  const editButton = (compact: boolean) => <Button aria-label={compact ? "Edit" : undefined} className="flex-none text-muted-foreground" data-edit-start disabled={state.kind !== "ready"}
    onClick={startEditing} size={compact ? "icon-sm" : "xs"} title="Edit Start" variant="ghost">
    <PencilIcon data-icon={compact ? undefined : "inline-start"} />{!compact && "Edit"}
  </Button>;
  const toolbar = editing
    ? <EditBar canReset={!isDefaultLayout(effective)} list={mode === "list"} onCancel={cancel} onDone={done} onReset={reset} saving={saving} />
    : mode === "tabs"
      ? <div className="flex min-w-0 items-center gap-1">
        <OverflowTabsList aria-label="Start widgets" className="min-w-0 flex-1" items={framed.map((widget) => ({
          value: widget.key, label: widget.title, id: tabId(widget.key), controls: panelId(widget.key),
        }))} />
        {preferences !== undefined && editButton(true)}
      </div>
      : preferences === undefined ? undefined : <div className="flex min-w-0 items-center justify-end">{editButton(false)}</div>;

  return <OverflowTabs className="grid min-w-0 grid-cols-1 gap-3" onValueChange={(key) => chosenWidget.save(storageKey, key)} ref={setRoot} value={active}>
    {state.kind === "failed" && <div className="flex flex-wrap items-center gap-2" role="alert">
      <p className="type-body text-destructive [overflow-wrap:anywhere]">The Start layout could not be loaded: {state.message}</p>
      <Button onClick={retry} size="xs" variant="outline">Retry</Button>
    </div>}
    {state.kind === "ready" && state.stored.problem !== undefined && !editing && <p className="type-body text-destructive [overflow-wrap:anywhere]" role="alert">
      {state.stored.problem} Saving a layout in Edit replaces it.
    </p>}
    {toolbar}
    {saveError !== undefined && <p className="type-body text-destructive [overflow-wrap:anywhere]" role="alert">{saveError}</p>}
    <div aria-busy={state.kind === "loading" || undefined}
      className={cn("relative grid min-w-0 [--start-gap-x:--spacing(12)] gap-x-(--start-gap-x) gap-y-12", mode !== "grid" && "grid-cols-1 [&>[data-start-section]>*]:order-1",
        editing && "select-none", gesture?.kind === "resize" && "cursor-ew-resize", gesture?.kind === "move" && "cursor-grabbing", state.kind === "loading" && "invisible")}
      data-dashboard={mode} data-editing={editing || undefined} data-grid={mode === "grid" ? grid : undefined} inert={saving} ref={setElement}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0" ref={setProbe} />
      {gesture?.kind === "resize" && <div aria-hidden className={cn("pointer-events-none absolute inset-0 grid gap-x-(--start-gap-x)", gridClass(grid))} data-column-guides>
        {Array.from({ length: grid }, (_, index) => <div className="rounded-xl border border-dashed border-primary/50 bg-primary/5" key={index} />)}
      </div>}
      {shown.map((widget) => {
        if (!isFramed(widget)) return <div className={cn(mode === "grid" ? "absolute" : "contents", editing && "[&>*]:opacity-60")} data-columns={mode === "grid" ? grid : undefined} data-pack={widget.key}
          data-start-section={widget.key} hidden={mode === "list"} inert={editing} key={widget.key} style={cellStyle(widget.key)}>
          <RenderBoundary resetKeys={[]} title="A Start widget could not be displayed"><WidgetContent content={widget.content} settings={settingsOf(widget).values} /></RenderBoundary>
        </div>;
        const place = draft?.findIndex((entry) => entry.key === widget.key) ?? -1;
        const dragging = gesture?.key === widget.key ? gesture.kind : undefined;
        const resizable = shownColumns(widget.minColumns, grid) < shownColumns(widget.maxColumns, grid);
        const titleRow = editing
          ? <EditTitleRow columns={widget.columns} first={place === 0} grid={grid} hint={hint} last={place === draft.length - 1} list={mode === "list"} onHandleKey={(event) => onHandleKey(event, widget.key)}
            onConfigure={widget.settings === undefined ? undefined : () => setConfiguring(widget.key)} onHandlePointer={(event) => startMove(event, widget.key)}
            onMove={(step) => move(widget.key, step, step < 0 ? "up" : "down")} onRemove={() => remove(widget.key)} resizing={dragging === "resize"} widget={widget} />
          : <SectionHeading className={cn("min-h-control-xs items-center", mode === "tabs" && "sr-only")} title={widget.title} />;
        return <div aria-labelledby={mode === "tabs" ? tabId(widget.key) : undefined}
          className={cn("group/cell min-w-0", mode === "grid" ? "absolute" : editing && "relative", editing && "rounded-xl",
            editing && mode === "grid" && cn("outline-2 outline-offset-4", dragging === undefined ? "outline-dashed outline-border-strong" : "bg-primary/5 outline-primary"),
            mode === "list" && cn("border bg-card px-3 py-2", dragging === "move" ? "border-primary" : "border-dashed border-border-strong"))}
          data-columns={mode === "grid" ? span(widget.key) : undefined} data-dragging={dragging} data-pack={widget.key} data-start-widget={widget.key}
          hidden={!editing && (empty.has(widget.key) || (mode === "tabs" && widget.key !== active))} id={mode === "tabs" ? panelId(widget.key) : undefined} key={widget.key}
          role={mode === "tabs" ? "tabpanel" : undefined} style={cellStyle(widget.key)}>
          <WidgetFrame editing={editing} empty={empty.has(widget.key)} list={mode === "list"} settings={settingsOf(widget)} titleRow={titleRow} widget={widget} />
          {editing && mode === "grid" && resizable && <div aria-hidden className="group/resize absolute inset-y-0 -right-3 z-10 w-5 cursor-ew-resize touch-none"
            data-resize-handle onPointerDown={(event) => startResize(event, widget.key)} title="Drag to resize">
            <span className={cn("absolute inset-y-0 left-[calc(50%+3px)] w-0.5 -translate-x-1/2 rounded-full", dragging === "resize" ? "bg-primary" : "group-hover/resize:bg-primary")} />
            <span className={cn("absolute top-[min(2.5rem,calc(50%-1.5rem))] left-[calc(50%+3px)] h-12 w-2 -translate-x-1/2 rounded-full shadow-card",
              dragging === "resize" ? "bg-primary" : "bg-border-strong group-hover/cell:bg-primary/70 group-hover/resize:bg-primary")} data-resize-grip />
          </div>}
          {dragging === "move" && <div aria-hidden className={cn("absolute rounded-full bg-primary", mode === "list" ? "inset-x-0 -top-2 h-1" : "inset-y-0 -left-3.5 w-1")} data-drop-indicator />}
        </div>;
      })}
      {editing && <Button className={cn("w-full rounded-xl border-dashed text-muted-foreground", mode === "grid" && "absolute h-24 transition-colors")} data-add-widget
        data-columns={mode === "grid" ? shownColumns(2, grid) : undefined} data-pack={ADD_TILE} onClick={() => setGalleryOpen(true)} style={mode === "grid" ? cellWidth(grid, shownColumns(2, grid)) : undefined} variant="outline"><PlusIcon data-icon="inline-start" />Add widget</Button>}
    </div>
    <p aria-live="polite" className="sr-only" role="status">{announcement}</p>
    {editing && <p className="sr-only" id={hint}>{mode === "list"
      ? "Arrow keys move the widget, Delete removes it."
      : "Arrow keys move the widget, Shift with Left or Right changes its width by one column, Delete removes it."}</p>}
    {gesture?.kind === "move" && <div aria-hidden className="pointer-events-none fixed z-50 flex items-center gap-1 rounded-lg border border-border-strong bg-popover px-2 py-1 type-item text-popover-foreground shadow-pop"
      style={{ left: gesture.point.x + 12, top: gesture.point.y + 12 }}><GripVerticalIcon className="size-3.5" />{titleOf(gesture.key)}</div>}
    {gesture?.kind === "resize" && <div aria-hidden className="pointer-events-none fixed z-50 rounded-lg border border-primary bg-popover px-2 py-1 type-item text-popover-foreground tabular-nums shadow-pop"
      data-resize-label style={{ left: gesture.point.x + 12, top: gesture.point.y + 12 }}>{widthText(gesture.columns)}</div>}
    {editing && galleryOpen && <WidgetGallery onAdd={add} onClose={() => { setGalleryOpen(false); setFocusTarget({ kind: "add" }); }} widgets={removed.filter(isFramed)} />}
    {configured?.settings !== undefined && <WidgetSettingsDialog key={configured.key} onApply={(values) => configure(configured.key, values)}
      onClose={() => { setConfiguring(undefined); setFocusTarget({ kind: "control", key: configured.key, control: "configure" }); }}
      problems={settingsOf(configured).problems} settings={configured.settings} title={configured.title} values={settingsOf(configured).values} />}
  </OverflowTabs>;
}
