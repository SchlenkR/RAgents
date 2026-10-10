import type { JsonValue } from "@ragents/engine/src/domain/json";
import { DASHBOARD_COLUMNS, type DashboardItem, type WidgetWidth } from "./dashboard-layout";
import type { StoredWidgetSettings } from "./widget-settings";

/** How a viewer arranged Start: the order of the framed widgets on it, their chosen widths in columns, the removed ones, and the values of their settings, each by widget ID. */
export interface DashboardPreferences {
  readonly order: readonly string[];
  readonly columns: ReadonlyMap<string, number>;
  readonly removed: readonly string[];
  /** As saved; a widget checks them against its settings when it renders. */
  readonly settings: ReadonlyMap<string, StoredWidgetSettings>;
}

export interface StoredDashboardLayout {
  readonly preferences: DashboardPreferences;
  /** Why the stored layout could not be read; Start then shows the default layout until the next save replaces it. */
  readonly problem?: string;
}

/** A widget as Start arranges it; a framed one offers the viewer the widths from minColumns to maxColumns. */
export type ArrangeableItem = DashboardItem & WidgetWidth;

export interface ArrangedWidgets<W extends ArrangeableItem> {
  /** The widgets to place, in order; framed ones carry their chosen columns. */
  readonly shown: readonly W[];
  /** The framed widgets that are not on the dashboard, in their default order and width. */
  readonly removed: readonly W[];
}

/** A framed widget on the dashboard while Start is edited; its place is its index in the draft. */
export interface PlacedWidget {
  readonly key: string;
  readonly columns: number;
}

export type DashboardDraft = readonly PlacedWidget[];

const FORMAT_VERSION = 3;
/** The formats with named sizes (1) and without settings (2); Start ignores such a layout. */
const FORMER_VERSIONS: readonly unknown[] = [1, 2];
const FIELDS = ["columns", "order", "removed", "settings", "version"];

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = { order: [], columns: new Map(), removed: [], settings: new Map() };

export const isDefaultLayout = (preferences: DashboardPreferences): boolean =>
  preferences.order.length === 0 && preferences.columns.size === 0 && preferences.removed.length === 0 && preferences.settings.size === 0;

const isColumns = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= DASHBOARD_COLUMNS;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

const isIdList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry !== "") && new Set(value).size === value.length;

/** Reads the value of the preference start.layout; null and a layout of a former format are the default layout. */
export function readDashboardLayout(value: JsonValue | null): StoredDashboardLayout {
  if (value === null) return { preferences: DEFAULT_DASHBOARD_PREFERENCES };
  const unreadable = (cause: string): StoredDashboardLayout => ({ preferences: DEFAULT_DASHBOARD_PREFERENCES, problem: `The saved Start layout could not be read: ${cause}.` });
  if (!isRecord(value)) return unreadable("expected an object");
  if (FORMER_VERSIONS.includes(value.version)) return { preferences: DEFAULT_DASHBOARD_PREFERENCES };
  const fields = Object.keys(value).sort();
  if (fields.join(",") !== FIELDS.join(",")) return unreadable(`expected the fields ${FIELDS.join(", ")}, found ${fields.join(", ") || "none"}`);
  const { version, order, columns, removed, settings } = value;
  if (version !== FORMAT_VERSION) return unreadable(`expected version ${FORMAT_VERSION}, found ${JSON.stringify(version)}`);
  if (!isIdList(order) || !isIdList(removed)) return unreadable("order and removed must list distinct widget IDs");
  if (!isRecord(columns) || !Object.values(columns).every(isColumns)) return unreadable(`columns must map widget IDs to whole numbers from 1 to ${DASHBOARD_COLUMNS}`);
  if (!isRecord(settings) || !Object.values(settings).every(isRecord)) return unreadable("settings must map widget IDs to objects of setting values");
  return { preferences: {
    order, columns: new Map(Object.entries(columns as Record<string, number>)), removed, settings: new Map(Object.entries(settings as Record<string, StoredWidgetSettings>)),
  } };
}

/** The default layout stores nothing, so Start follows its contributions again. */
export const writeDashboardLayout = (preferences: DashboardPreferences): JsonValue | null => isDefaultLayout(preferences) ? null : {
  version: FORMAT_VERSION, order: [...preferences.order], columns: Object.fromEntries(preferences.columns), removed: [...preferences.removed],
  settings: Object.fromEntries(preferences.settings),
};

/** The framed widgets that the order names take their slots in that order; every other widget keeps its default place. */
const ordered = <W extends Pick<DashboardItem, "key" | "framed">>(widgets: readonly W[], order: readonly string[]): readonly W[] => {
  const rank = new Map(order.map((key, index) => [key, index]));
  const placed = (widget: W) => widget.framed && rank.has(widget.key);
  const sorted = widgets.filter(placed).sort((left, right) => rank.get(left.key)! - rank.get(right.key)!);
  return widgets.reduce<{ readonly taken: number; readonly widgets: readonly W[] }>((state, widget) => placed(widget)
    ? { taken: state.taken + 1, widgets: [...state.widgets, sorted[state.taken]!] }
    : { taken: state.taken, widgets: [...state.widgets, widget] }, { taken: 0, widgets: [] }).widgets;
};

const offers = (widget: Pick<WidgetWidth, "minColumns" | "maxColumns">, columns: number): boolean =>
  Number.isInteger(columns) && columns >= widget.minColumns && columns <= widget.maxColumns;

/** Applies order, widths, and removals to Start's widgets in their default order; IDs of widgets that are not there and widths a widget does not offer are ignored. */
export function arrangeWidgets<W extends ArrangeableItem>(widgets: readonly W[], preferences: DashboardPreferences): ArrangedWidgets<W> {
  const keys = widgets.map((widget) => widget.key);
  const twice = keys.find((key, index) => keys.indexOf(key) !== index);
  if (twice !== undefined) throw new Error(`Start has two widgets with the ID ${twice}.`);
  const removed = new Set(preferences.removed);
  const chosen = (widget: W): number => {
    const columns = preferences.columns.get(widget.key);
    return columns !== undefined && offers(widget, columns) ? columns : widget.columns;
  };
  const arranged = ordered(widgets, preferences.order).map((widget) => widget.framed ? { ...widget, columns: chosen(widget) } : widget);
  return {
    shown: arranged.filter((widget) => !widget.framed || !removed.has(widget.key)),
    removed: widgets.filter((widget) => widget.framed && removed.has(widget.key)),
  };
}

/** The framed widgets on the dashboard as edit mode starts from them. */
export const draftOf = (shown: readonly ArrangeableItem[]): DashboardDraft =>
  shown.filter((widget) => widget.framed).map(({ key, columns }) => ({ key, columns }));

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

export function resizeWidget(draft: DashboardDraft, key: string, columns: number, range: Pick<WidgetWidth, "minColumns" | "maxColumns">): DashboardDraft {
  if (!offers(range, columns)) throw new Error(`Start widget ${key} cannot be ${columns} columns wide.`);
  placeOf(draft, key);
  return draft.map((widget) => widget.key === key ? { key, columns } : widget);
}

export function removeWidget(draft: DashboardDraft, key: string): DashboardDraft {
  placeOf(draft, key);
  return draft.filter((widget) => widget.key !== key);
}

/** A widget from the gallery joins at the end in its default width. */
export function addWidget(draft: DashboardDraft, widget: Pick<ArrangeableItem, "key" | "columns">): DashboardDraft {
  if (draft.some((entry) => entry.key === widget.key)) throw new Error(`Start widget ${widget.key} is already on the dashboard.`);
  return [...draft, { key: widget.key, columns: widget.columns }];
}

/** The preferences that show the draft; the default order and default widths store nothing, widgets that are not there now keep their removal and width while their place falls back to the default, and settings stay as they are. */
export function preferencesOf(draft: DashboardDraft, widgets: readonly ArrangeableItem[], previous: DashboardPreferences): DashboardPreferences {
  const framed = widgets.filter((widget) => widget.framed);
  const present = new Set(widgets.map((widget) => widget.key));
  const placed = new Set(draft.map((widget) => widget.key));
  if (placed.size !== draft.length) throw new Error("A Start widget is placed twice.");
  const defaults = new Map(framed.map((widget) => [widget.key, widget]));
  const stranger = draft.find((widget) => !defaults.has(widget.key));
  if (stranger !== undefined) throw new Error(`Start has no widget ${stranger.key} to place.`);
  const unfit = draft.find((widget) => !offers(defaults.get(widget.key)!, widget.columns));
  if (unfit !== undefined) throw new Error(`Start widget ${unfit.key} cannot be ${unfit.columns} columns wide.`);
  const inDefaultOrder = framed.filter((widget) => placed.has(widget.key)).map((widget) => widget.key);
  const order = draft.map((widget) => widget.key);
  const chosen = draft.filter((widget) => widget.columns !== defaults.get(widget.key)!.columns).map((widget): [string, number] => [widget.key, widget.columns]);
  return {
    order: order.every((key, index) => key === inDefaultOrder[index]) ? [] : order,
    columns: new Map([...[...previous.columns].filter(([key]) => !present.has(key)), ...chosen]),
    removed: [...previous.removed.filter((key) => !present.has(key)), ...framed.filter((widget) => !placed.has(widget.key)).map((widget) => widget.key)],
    settings: previous.settings,
  };
}

/** The preferences with a widget's stored settings replaced, or removed when it stores none. */
export const configureWidget = (preferences: DashboardPreferences, key: string, stored: StoredWidgetSettings | undefined): DashboardPreferences => ({
  ...preferences,
  settings: new Map([...[...preferences.settings].filter(([widget]) => widget !== key), ...stored === undefined ? [] : [[key, stored] as const]]),
});
