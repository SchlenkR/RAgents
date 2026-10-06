export interface TableColumnDefinition {
  id: string;
  label?: string;
  width?: number;
  minWidth?: number;
  resizable?: boolean;
}

export type TableColumnWidths = Readonly<Record<string, number>>;

export const tableWidthsKey = (id: string) => `ragents.table.widths:${encodeURIComponent(id)}`;

export function parseTableColumnWidths(raw: string | null): TableColumnWidths {
  if (raw === null) return {};
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Object.entries(value).some(([id, width]) => !id.trim() || typeof width !== "number" || !Number.isFinite(width) || width <= 0)) {
    throw new Error("The saved table column widths are invalid.");
  }
  return value as TableColumnWidths;
}

export function validateTableColumns(columns: readonly TableColumnDefinition[]) {
  if (columns.length === 0 || new Set(columns.map((column) => column.id)).size !== columns.length
    || columns.some((column) => !column.id.trim())) {
    throw new Error("A resizable table requires columns with unique, non-empty IDs.");
  }
  if (columns.some((column) => [column.width, column.minWidth].some((width) => width !== undefined && (!Number.isFinite(width) || width <= 0)))) {
    throw new Error("Table column widths must be finite, positive numbers.");
  }
}

export const tableColumnMinimum = (column: TableColumnDefinition) => column.minWidth ?? 64;
export const tableColumnWidth = (column: TableColumnDefinition, widths: TableColumnWidths) =>
  Math.max(tableColumnMinimum(column), (Object.hasOwn(widths, column.id) ? widths[column.id] : undefined) ?? column.width ?? 180);
