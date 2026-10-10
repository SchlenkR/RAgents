import type { JsonValue } from "@ragents/engine/src/domain/json";
import { START_WIDGET_SPANS, type StartWidgetSpan } from "../PluginRegistry";
import type { DashboardItem } from "./dashboard-layout";

/** How a viewer arranged Start: the order of the framed widgets on it, their chosen sizes, and the removed ones, each by widget ID. */
export interface DashboardPreferences {
  readonly order: readonly string[];
  readonly spans: ReadonlyMap<string, StartWidgetSpan>;
  readonly removed: readonly string[];
}

export interface StoredDashboardLayout {
  readonly preferences: DashboardPreferences;
  /** Why the stored layout could not be read; Start then shows the default layout until the next save replaces it. */
  readonly problem?: string;
}

/** A widget as Start arranges it; a framed one offers the viewer these sizes. */
export interface ArrangeableItem extends DashboardItem {
  readonly sizes: readonly StartWidgetSpan[];
}

export interface ArrangedWidgets<W extends ArrangeableItem> {
  /** The widgets to place, in order; framed ones carry their chosen span. */
  readonly shown: readonly W[];
  /** The framed widgets that are not on the dashboard, in their default order and size. */
  readonly removed: readonly W[];
}

/** A framed widget on the dashboard while Start is edited; its place is its index in the draft. */
export interface PlacedWidget {
  readonly key: string;
  readonly span: StartWidgetSpan;
}

export type DashboardDraft = readonly PlacedWidget[];

const FORMAT_VERSION = 1;
const FIELDS = ["order", "removed", "spans", "version"];

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = { order: [], spans: new Map(), removed: [] };

export const isDefaultLayout = (preferences: DashboardPreferences): boolean =>
  preferences.order.length === 0 && preferences.spans.size === 0 && preferences.removed.length === 0;

const isSpan = (value: unknown): value is StartWidgetSpan => START_WIDGET_SPANS.some((span) => span === value);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

const isIdList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry !== "") && new Set(value).size === value.length;

/** Reads the value of the preference start.layout; null is the default layout. */
export function readDashboardLayout(value: JsonValue | null): StoredDashboardLayout {
  if (value === null) return { preferences: DEFAULT_DASHBOARD_PREFERENCES };
  const unreadable = (cause: string): StoredDashboardLayout => ({ preferences: DEFAULT_DASHBOARD_PREFERENCES, problem: `The saved Start layout could not be read: ${cause}.` });
  if (!isRecord(value)) return unreadable("expected an object");
  const fields = Object.keys(value).sort();
  if (fields.join(",") !== FIELDS.join(",")) return unreadable(`expected the fields ${FIELDS.join(", ")}, found ${fields.join(", ") || "none"}`);
  const { version, order, spans, removed } = value;
  if (version !== FORMAT_VERSION) return unreadable(`expected version ${FORMAT_VERSION}, found ${JSON.stringify(version)}`);
  if (!isIdList(order) || !isIdList(removed)) return unreadable("order and removed must list distinct widget IDs");
  if (!isRecord(spans) || !Object.values(spans).every(isSpan)) return unreadable(`spans must map widget IDs to ${START_WIDGET_SPANS.join(", ")}`);
  return { preferences: { order, spans: new Map(Object.entries(spans as Record<string, StartWidgetSpan>)), removed } };
}

/** The default layout stores nothing, so Start follows its contributions again. */
export const writeDashboardLayout = (preferences: DashboardPreferences): JsonValue | null => isDefaultLayout(preferences) ? null
  : { version: FORMAT_VERSION, order: [...preferences.order], spans: Object.fromEntries(preferences.spans), removed: [...preferences.removed] };

/** The framed widgets that the order names take their slots in that order; every other widget keeps its default place. */
const ordered = <W extends Pick<DashboardItem, "key" | "framed">>(widgets: readonly W[], order: readonly string[]): readonly W[] => {
  const rank = new Map(order.map((key, index) => [key, index]));
  const placed = (widget: W) => widget.framed && rank.has(widget.key);
  const sorted = widgets.filter(placed).sort((left, right) => rank.get(left.key)! - rank.get(right.key)!);
  return widgets.reduce<{ readonly taken: number; readonly widgets: readonly W[] }>((state, widget) => placed(widget)
    ? { taken: state.taken + 1, widgets: [...state.widgets, sorted[state.taken]!] }
    : { taken: state.taken, widgets: [...state.widgets, widget] }, { taken: 0, widgets: [] }).widgets;
};

/** Applies order, sizes, and removals to Start's widgets in their default order; IDs of widgets that are not there and sizes a widget does not offer are ignored. */
export function arrangeWidgets<W extends ArrangeableItem>(widgets: readonly W[], preferences: DashboardPreferences): ArrangedWidgets<W> {
  const keys = widgets.map((widget) => widget.key);
  const twice = keys.find((key, index) => keys.indexOf(key) !== index);
  if (twice !== undefined) throw new Error(`Start has two widgets with the ID ${twice}.`);
  const removed = new Set(preferences.removed);
  const chosen = (widget: W): StartWidgetSpan => {
    const span = preferences.spans.get(widget.key);
    return span !== undefined && widget.sizes.includes(span) ? span : widget.span;
  };
  const arranged = ordered(widgets, preferences.order).map((widget) => widget.framed ? { ...widget, span: chosen(widget) } : widget);
  return {
    shown: arranged.filter((widget) => !widget.framed || !removed.has(widget.key)),
    removed: widgets.filter((widget) => widget.framed && removed.has(widget.key)),
  };
}

/** The framed widgets on the dashboard as edit mode starts from them. */
export const draftOf = (shown: readonly ArrangeableItem[]): DashboardDraft =>
  shown.filter((widget) => widget.framed).map(({ key, span }) => ({ key, span }));

const placeOf = (draft: DashboardDraft, key: string): number => {
  const index = draft.findIndex((widget) => widget.key === key);
  if (index < 0) throw new Error(`Start has no widget ${key} on the dashboard.`);
  return index;
};

/** Moves a widget to a place among the widgets on the dashboard, counted after taking it out. */
export function moveWidget(draft: DashboardDraft, key: string, to: number): DashboardDraft {
  const from = placeOf(draft, key);
  const others = draft.filter((_, index) => index !== from);
  if (!Number.isInteger(to) || to < 0 || to > others.length) throw new Error(`Start cannot move ${key} to place ${to} of ${draft.length}.`);
  return [...others.slice(0, to), draft[from]!, ...others.slice(to)];
}

export function resizeWidget(draft: DashboardDraft, key: string, span: StartWidgetSpan, sizes: readonly StartWidgetSpan[]): DashboardDraft {
  if (!sizes.includes(span)) throw new Error(`Start widget ${key} offers no size ${span}.`);
  placeOf(draft, key);
  return draft.map((widget) => widget.key === key ? { key, span } : widget);
}

export function removeWidget(draft: DashboardDraft, key: string): DashboardDraft {
  placeOf(draft, key);
  return draft.filter((widget) => widget.key !== key);
}

/** A widget from the gallery joins at the end in its default size. */
export function addWidget(draft: DashboardDraft, widget: Pick<ArrangeableItem, "key" | "span">): DashboardDraft {
  if (draft.some((entry) => entry.key === widget.key)) throw new Error(`Start widget ${widget.key} is already on the dashboard.`);
  return [...draft, { key: widget.key, span: widget.span }];
}

/** The preferences that show the draft; the default order and default sizes store nothing, and widgets that are not there now keep their removal and size while their place falls back to the default. */
export function preferencesOf(draft: DashboardDraft, widgets: readonly ArrangeableItem[], previous: DashboardPreferences): DashboardPreferences {
  const framed = widgets.filter((widget) => widget.framed);
  const present = new Set(widgets.map((widget) => widget.key));
  const placed = new Set(draft.map((widget) => widget.key));
  if (placed.size !== draft.length) throw new Error("A Start widget is placed twice.");
  const defaults = new Map(framed.map((widget) => [widget.key, widget]));
  const stranger = draft.find((widget) => !defaults.has(widget.key));
  if (stranger !== undefined) throw new Error(`Start has no widget ${stranger.key} to place.`);
  const unsized = draft.find((widget) => !defaults.get(widget.key)!.sizes.includes(widget.span));
  if (unsized !== undefined) throw new Error(`Start widget ${unsized.key} offers no size ${unsized.span}.`);
  const inDefaultOrder = framed.filter((widget) => placed.has(widget.key)).map((widget) => widget.key);
  const order = draft.map((widget) => widget.key);
  const chosen = draft.filter((widget) => widget.span !== defaults.get(widget.key)!.span).map((widget): [string, StartWidgetSpan] => [widget.key, widget.span]);
  return {
    order: order.every((key, index) => key === inDefaultOrder[index]) ? [] : order,
    spans: new Map([...[...previous.spans].filter(([key]) => !present.has(key)), ...chosen]),
    removed: [...previous.removed.filter((key) => !present.has(key)), ...framed.filter((widget) => !placed.has(widget.key)).map((widget) => widget.key)],
  };
}
