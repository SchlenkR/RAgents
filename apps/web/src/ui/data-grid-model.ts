import type { ColumnDef, Row } from "@tanstack/react-table";
import type { DataGridColumn } from "./data-grid";
import { tableColumnWidth, validateTableColumns, type TableColumnWidths } from "./table-widths";

export type DataGridValue = string | number | boolean | null | undefined;

export const displayGridValue = (value: DataGridValue) => value == null ? "" : typeof value === "boolean" ? value ? "Yes" : "No" : String(value);

function compareValues<T>(left: Row<T>, right: Row<T>, id: string) {
  const a = left.getValue<DataGridValue>(id);
  const b = right.getValue<DataGridValue>(id);
  if (a == null || b == null) return 0;
  return typeof a === "number" && typeof b === "number" ? a - b
    : typeof a === "boolean" && typeof b === "boolean" ? Number(a) - Number(b)
    : String(a).localeCompare(String(b), "en-US", { numeric: true });
}

export function gridColumnDefinitions<T>(columns: readonly DataGridColumn<T>[]): ColumnDef<T>[] {
  validateTableColumns(columns);
  if (columns.filter((column) => column.flex).length > 1) throw new Error("A data grid supports one flexible column.");
  return columns.map((column) => ({
    id: column.id,
    header: column.label,
    accessorFn: (row) => column.value?.(row) ?? undefined,
    cell: (context) => column.render ? column.render(context.row.original) : displayGridValue(context.getValue<DataGridValue>()),
    size: column.width ?? 180,
    minSize: column.minWidth ?? 64,
    maxSize: Number.MAX_SAFE_INTEGER,
    enableResizing: column.resizable !== false,
    enableSorting: column.sortable === true && column.value !== undefined,
    sortingFn: compareValues<T>,
    sortUndefined: "last",
  }));
}

export function gridColumnSizes<T>(columns: readonly DataGridColumn<T>[], widths: TableColumnWidths, available: number, selectionWidth = 0) {
  const sizes = Object.fromEntries(columns.map((column) => [column.id, tableColumnWidth(column, widths)]));
  const flexible = columns.find((column) => column.flex) ?? columns.at(-1);
  if (flexible) {
    const fixed = columns.filter((column) => column !== flexible).reduce((sum, column) => sum + sizes[column.id], selectionWidth);
    sizes[flexible.id] = Math.max(sizes[flexible.id], available - fixed);
  }
  return sizes;
}
