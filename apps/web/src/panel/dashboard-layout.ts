import type { StartWidgetSpan } from "../PluginRegistry";

/** Below this width of the dashboard, measured on its own container, several framed widgets become tabs. */
export const DASHBOARD_TABS_BELOW = 700;
/** From this width on, widgets take their preferred span; between both limits narrower spans grow to half a row. */
export const DASHBOARD_WIDE_FROM = 1100;
export const DASHBOARD_COLUMNS = 12;

const SPAN_COLUMNS = {
  wide: { narrow: 4, half: 6, wide: 8, full: 12 },
  medium: { narrow: 6, half: 6, wide: 6, full: 12 },
} as const satisfies Record<string, Record<StartWidgetSpan, number>>;

export interface DashboardItem {
  readonly key: string;
  readonly span: StartWidgetSpan;
  /** A framed widget with a title; only these become tabs. */
  readonly framed: boolean;
}

export type DashboardLayout =
  | { readonly mode: "tabs" }
  | { readonly mode: "grid"; readonly columns: ReadonlyMap<string, number> };

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

const rowsOf = (spans: readonly number[]): readonly (readonly number[])[] => spans.reduce<readonly (readonly number[])[]>((rows, span) => {
  const last = rows.at(-1);
  return last !== undefined && sum(last) + span <= DASHBOARD_COLUMNS ? [...rows.slice(0, -1), [...last, span]] : [...rows, [span]];
}, []);

/** A row with space left widens its widgets in proportion, so that every row ends at the right edge. */
const filled = (row: readonly number[]): readonly number[] => {
  const scaled = row.map((span) => Math.round(span * DASHBOARD_COLUMNS / sum(row)));
  const rest = DASHBOARD_COLUMNS - sum(scaled);
  return scaled.map((span, index) => index === scaled.length - 1 ? span + rest : span);
};

/** How Start arranges its widgets at a container width; without a measured width it assumes a wide screen. */
export function dashboardLayout(items: readonly DashboardItem[], width: number | undefined): DashboardLayout {
  const narrow = width !== undefined && width < DASHBOARD_TABS_BELOW;
  if (narrow && items.filter((item) => item.framed).length > 1) return { mode: "tabs" };
  const tier = narrow ? undefined : width === undefined || width >= DASHBOARD_WIDE_FROM ? SPAN_COLUMNS.wide : SPAN_COLUMNS.medium;
  const columns = rowsOf(items.map((item) => tier === undefined ? DASHBOARD_COLUMNS : tier[item.span])).flatMap(filled);
  return { mode: "grid", columns: new Map(items.map((item, index) => [item.key, columns[index]!])) };
}
