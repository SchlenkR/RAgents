import { START_WIDGET_SPANS, type StartWidgetSpan } from "../PluginRegistry";
import type { DashboardItem } from "./dashboard-layout";

/** How a viewer arranged Start: the order of the framed widgets, their chosen spans, and the hidden ones, each by widget ID. */
export interface DashboardPreferences {
  readonly order: readonly string[];
  readonly spans: ReadonlyMap<string, StartWidgetSpan>;
  readonly hidden: readonly string[];
}

export interface StoredDashboardLayout {
  readonly preferences: DashboardPreferences;
  /** Why the stored layout could not be read; Start then shows the default layout and offers the reset. */
  readonly problem?: string;
}

export interface ArrangedWidgets<W extends DashboardItem> {
  /** The widgets to place, in order; framed ones carry their chosen span. */
  readonly shown: readonly W[];
  /** The framed widgets the viewer hid, in the same order. */
  readonly hidden: readonly W[];
}

const FORMAT_VERSION = 1;
const FIELDS = ["hidden", "order", "spans", "version"];

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = { order: [], spans: new Map(), hidden: [] };

/** Per server origin and signed-in user, in the storage of the browser or VS Code panel that shows Start. */
export const startLayoutStorageKey = (origin: string, user: string | null): string =>
  `ragents.start.layout:${encodeURIComponent(origin)}${user === null ? "" : `:${encodeURIComponent(user)}`}`;

export const isDefaultLayout = (preferences: DashboardPreferences): boolean =>
  preferences.order.length === 0 && preferences.spans.size === 0 && preferences.hidden.length === 0;

const isSpan = (value: unknown): value is StartWidgetSpan => START_WIDGET_SPANS.some((span) => span === value);

const isIdList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry !== "") && new Set(value).size === value.length;

const parsedJson = (raw: string): { readonly value: unknown } | { readonly error: string } => {
  try {
    return { value: JSON.parse(raw) as unknown };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
};

export function readDashboardLayout(raw: string | null): StoredDashboardLayout {
  if (raw === null) return { preferences: DEFAULT_DASHBOARD_PREFERENCES };
  const unreadable = (cause: string): StoredDashboardLayout => ({ preferences: DEFAULT_DASHBOARD_PREFERENCES, problem: `The saved Start layout could not be read: ${cause}.` });
  const parsed = parsedJson(raw);
  if ("error" in parsed) return unreadable(parsed.error);
  const record = parsed.value;
  if (typeof record !== "object" || record === null || Array.isArray(record)) return unreadable("expected an object");
  const fields = Object.keys(record).sort();
  if (fields.join(",") !== FIELDS.join(",")) return unreadable(`expected the fields ${FIELDS.join(", ")}, found ${fields.join(", ") || "none"}`);
  const { version, order, spans, hidden } = record as Record<string, unknown>;
  if (version !== FORMAT_VERSION) return unreadable(`expected version ${FORMAT_VERSION}, found ${JSON.stringify(version)}`);
  if (!isIdList(order) || !isIdList(hidden)) return unreadable("order and hidden must list distinct widget IDs");
  if (typeof spans !== "object" || spans === null || Array.isArray(spans) || !Object.values(spans).every(isSpan)) {
    return unreadable(`spans must map widget IDs to ${START_WIDGET_SPANS.join(", ")}`);
  }
  return { preferences: { order, spans: new Map(Object.entries(spans as Record<string, StartWidgetSpan>)), hidden } };
}

export const writeDashboardLayout = (preferences: DashboardPreferences): string =>
  JSON.stringify({ version: FORMAT_VERSION, order: preferences.order, spans: Object.fromEntries(preferences.spans), hidden: preferences.hidden });

/** The framed widgets that the order names take their slots in that order; every other widget keeps its default place. */
const ordered = <W extends Pick<DashboardItem, "key" | "framed">>(widgets: readonly W[], order: readonly string[]): readonly W[] => {
  const rank = new Map(order.map((key, index) => [key, index]));
  const placed = (widget: W) => widget.framed && rank.has(widget.key);
  const sorted = widgets.filter(placed).sort((left, right) => rank.get(left.key)! - rank.get(right.key)!);
  return widgets.reduce<{ readonly taken: number; readonly widgets: readonly W[] }>((state, widget) => placed(widget)
    ? { taken: state.taken + 1, widgets: [...state.widgets, sorted[state.taken]!] }
    : { taken: state.taken, widgets: [...state.widgets, widget] }, { taken: 0, widgets: [] }).widgets;
};

/** Applies order, spans, and hiding to Start's widgets in their default order; IDs of widgets that are not there are ignored. */
export function arrangeWidgets<W extends DashboardItem>(widgets: readonly W[], preferences: DashboardPreferences): ArrangedWidgets<W> {
  const keys = widgets.map((widget) => widget.key);
  const twice = keys.find((key, index) => keys.indexOf(key) !== index);
  if (twice !== undefined) throw new Error(`Start has two widgets with the ID ${twice}.`);
  const hidden = new Set(preferences.hidden);
  const arranged = ordered(widgets, preferences.order)
    .map((widget) => widget.framed ? { ...widget, span: preferences.spans.get(widget.key) ?? widget.span } : widget);
  return {
    shown: arranged.filter((widget) => !widget.framed || !hidden.has(widget.key)),
    hidden: arranged.filter((widget) => widget.framed && hidden.has(widget.key)),
  };
}

/** The default span stores no choice, so a widget follows its contribution again. */
export function withSpan(preferences: DashboardPreferences, key: string, span: StartWidgetSpan, fallback: StartWidgetSpan): DashboardPreferences {
  const others = [...preferences.spans].filter(([id]) => id !== key);
  return { ...preferences, spans: new Map(span === fallback ? others : [...others, [key, span]]) };
}

/** Swaps a widget with a neighbor in the order of all framed widgets, hidden ones included; the default order stores no order, so later widgets keep their default place. */
export function withSwap(preferences: DashboardPreferences, framed: readonly string[], key: string, neighbor: string): DashboardPreferences {
  const missing = [key, neighbor].find((id) => !framed.includes(id));
  if (missing !== undefined) throw new Error(`Start has no widget ${missing} to move.`);
  const current = ordered(framed.map((id) => ({ key: id, framed: true })), preferences.order).map((widget) => widget.key);
  const swapped = current.map((id) => id === key ? neighbor : id === neighbor ? key : id);
  return { ...preferences, order: swapped.every((id, index) => id === framed[index]) ? [] : swapped };
}

export function withHidden(preferences: DashboardPreferences, key: string, hide: boolean): DashboardPreferences {
  const others = preferences.hidden.filter((id) => id !== key);
  return { ...preferences, hidden: hide ? [...others, key] : others };
}
