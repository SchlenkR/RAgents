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

/** A widget to pack: the columns it takes in the grid shown and its measured height in pixels; a widget without height takes no place. */
export interface PackItem {
  readonly key: string;
  readonly columns: number;
  readonly height: number;
}

/** Where packing puts a widget: its first column, its columns, and its top in pixels. */
export interface PackedWidget {
  readonly key: string;
  readonly column: number;
  readonly columns: number;
  readonly top: number;
}

export interface Packing {
  /** In the order of the items, without those that have no height. */
  readonly widgets: readonly PackedWidget[];
  /** From the top of the grid to the bottom of its lowest widget. */
  readonly height: number;
}

/** Tops closer than this count as equal, so that a fraction of a pixel never moves a widget away from the left. */
const SAME_TOP = 0.5;

/** Places widgets in order, each at the lowest top that any range of its columns offers below the widgets placed before, leftmost among equal tops; widgets keep their own heights, so a short widget leaves no hole beside a tall one. */
export function packWidgets(items: readonly PackItem[], grid: number, gap: number): Packing {
  const packed = items.reduce<{ readonly skyline: readonly number[]; readonly widgets: readonly PackedWidget[] }>((state, item) => {
    if (!Number.isInteger(item.columns) || item.columns < 1 || item.columns > grid) throw new Error(`Start widget ${item.key} cannot take ${item.columns} of ${grid} columns.`);
    if (!(item.height > 0)) return state;
    const best = Array.from({ length: grid - item.columns + 1 }, (_, column) => ({ column, top: Math.max(...state.skyline.slice(column, column + item.columns)) }))
      .reduce((chosen, candidate) => candidate.top < chosen.top - SAME_TOP ? candidate : chosen);
    const bottom = best.top + item.height + gap;
    return {
      skyline: state.skyline.map((level, column) => column >= best.column && column < best.column + item.columns ? bottom : level),
      widgets: [...state.widgets, { key: item.key, column: best.column, columns: item.columns, top: best.top }],
    };
  }, { skyline: Array.from({ length: grid }, () => 0), widgets: [] });
  return { widgets: packed.widgets, height: Math.max(0, ...packed.skyline.map((level) => level - gap)) };
}

/** A widget's box in the grid's own pixels, from its top left corner. */
export interface WidgetBox {
  readonly key: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const contains = (box: WidgetBox, point: { readonly x: number; readonly y: number }): boolean =>
  point.x >= box.left && point.x < box.left + box.width && point.y >= box.top && point.y < box.top + box.height;

/** The place a dragged widget takes among the others: before or after the widget under the pointer by its middle, horizontally, or vertically for one as wide as the grid; the end below every widget or over the end tile; undefined anywhere else, so the place stays. */
export function dropPlace(boxes: readonly WidgetBox[], dragged: string, point: { readonly x: number; readonly y: number }, gridWidth: number, end?: WidgetBox): number | undefined {
  const others = boxes.filter((box) => box.key !== dragged);
  const under = others.findIndex((box) => contains(box, point));
  if (under >= 0) {
    const box = others[under]!;
    const after = box.width >= gridWidth - 1 ? point.y >= box.top + box.height / 2 : point.x >= box.left + box.width / 2;
    return after ? under + 1 : under;
  }
  if ((end !== undefined && contains(end, point)) || boxes.every((box) => point.y >= box.top + box.height)) return others.length;
  return undefined;
}
