/** Below this width of the dashboard, measured on its own container, several framed widgets become tabs. */
export const DASHBOARD_TABS_BELOW = 700;
/** From this width on the grid has all its columns; between both limits it has half of them. */
export const DASHBOARD_WIDE_FROM = 1100;
/** The columns of the grid on a wide dashboard; a widget is a whole number of them wide. */
export const DASHBOARD_COLUMNS = 6;

/** A widget's width in columns of the six-column grid and the widths the viewer may choose in edit mode. */
export interface WidgetWidth {
  readonly columns: number;
  readonly minColumns: number;
  readonly maxColumns: number;
}

/** A width as a contribution declares it; columns default to the whole row and the range to every width. */
export type DeclaredWidth = { readonly [Field in keyof WidgetWidth]?: number };

export interface DashboardItem {
  readonly key: string;
  readonly columns: number;
  /** A framed widget with a title; only these become tabs. */
  readonly framed: boolean;
}

export type DashboardLayout =
  | { readonly mode: "tabs" }
  | { readonly mode: "grid"; readonly grid: number; readonly columns: ReadonlyMap<string, number> };

const widthWithDefaults = ({ columns, minColumns, maxColumns }: DeclaredWidth): WidgetWidth =>
  ({ columns: columns ?? DASHBOARD_COLUMNS, minColumns: minColumns ?? 1, maxColumns: maxColumns ?? DASHBOARD_COLUMNS });

/** Why a declared width is not one Start can show, or undefined when it is. */
export function widthProblem(declared: DeclaredWidth): string | undefined {
  const width = widthWithDefaults(declared);
  const invalid = (["columns", "minColumns", "maxColumns"] as const).find((field) => !Number.isInteger(width[field]) || width[field] < 1 || width[field] > DASHBOARD_COLUMNS);
  if (invalid !== undefined) return `has ${invalid} ${String(width[invalid])}; allowed are whole numbers from 1 to ${DASHBOARD_COLUMNS}`;
  if (width.minColumns > width.columns || width.columns > width.maxColumns) {
    return `has ${width.columns} columns outside its range from minColumns ${width.minColumns} to maxColumns ${width.maxColumns}`;
  }
  return undefined;
}

/** The width of a contribution with its defaults; a width Start cannot show is an error. */
export function widgetWidth(declared: DeclaredWidth): WidgetWidth {
  const problem = widthProblem(declared);
  if (problem !== undefined) throw new Error(`A Start widget ${problem}.`);
  return widthWithDefaults(declared);
}

/** The columns of the grid at a dashboard width; without a measured width Start assumes a wide screen. */
export const gridColumnsAt = (width: number | undefined): number =>
  width === undefined || width >= DASHBOARD_WIDE_FROM ? DASHBOARD_COLUMNS : width >= DASHBOARD_TABS_BELOW ? DASHBOARD_COLUMNS / 2 : 1;

/** The columns a widget of this width takes in a grid of fewer columns, rounded up. */
export const shownColumns = (columns: number, grid: number): number => Math.ceil(columns * grid / DASHBOARD_COLUMNS);

/** The columns to store for a width the grid shows, kept within the widget's range: its columns when they show it already, otherwise the most columns that show it. */
export function resizedColumns(width: WidgetWidth, shown: number, grid: number): number {
  const target = Math.min(shownColumns(width.maxColumns, grid), Math.max(shownColumns(width.minColumns, grid), Math.round(shown)));
  return shownColumns(width.columns, grid) === target ? width.columns : Math.min(width.maxColumns, Math.floor(target * DASHBOARD_COLUMNS / grid));
}

/** The columns a resize drag reaches: the shown width at its start plus the columns the pointer moved, snapped to the nearest column edge. */
export const draggedColumns = (width: WidgetWidth, grid: number, moved: number, pitch: number): number =>
  resizedColumns(width, shownColumns(width.columns, grid) + moved / pitch, grid);

/** How Start arranges its widgets at a container width: each framed widget takes its columns, a section without a title the whole row. */
export function dashboardLayout(items: readonly DashboardItem[], width: number | undefined): DashboardLayout {
  const grid = gridColumnsAt(width);
  if (grid === 1 && items.filter((item) => item.framed).length > 1) return { mode: "tabs" };
  return { mode: "grid", grid, columns: new Map(items.map((item) => [item.key, item.framed ? shownColumns(item.columns, grid) : grid])) };
}
