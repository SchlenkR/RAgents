import type { ReactElement, ReactNode } from "react";

export type TableValue = string | number | boolean | null | undefined;
export interface TableColumn<Row> {
  id: string;
  label: string;
  /** Primitive value used for sorting, filtering and default display. */
  value: (row: Row) => TableValue;
  render?: (row: Row) => ReactNode;
  sortable?: boolean;
  /** Searched when table filtering is enabled; defaults to true. */
  filterable?: boolean;
}
export interface TableAction<Row> {
  id: string;
  label: string;
  onClick: (row: Row) => void | Promise<void>;
  disabled?: (row: Row) => boolean;
}
interface DataTableBaseProps<Row> {
  title?: string;
  rows: readonly Row[];
  columns: readonly TableColumn<Row>[];
  rowKey: (row: Row) => string;
  filterable?: boolean;
  actions?: readonly TableAction<Row>[];
  loading?: boolean;
  emptyText?: string;
}
export type DataTableProps<Row> = DataTableBaseProps<Row> & (
  | { selectedKeys: readonly string[]; onSelectionChange: (keys: string[]) => void }
  | { selectedKeys?: never; onSelectionChange?: never }
);

export declare function DataTable<Row>(props: DataTableProps<Row>): ReactElement;
