import React, { useId, useRef, useState } from "react";
import { Badge, Button, DataGrid, SearchInput } from "../../ui";
import type { DataTableProps, TableAction, TableColumn, TableValue } from "./table-contracts";

const displayValue = (value: TableValue) => value === null || value === undefined ? "" : typeof value === "boolean" ? value ? "Yes" : "No" : String(value);

export function tableRows<Row>(rows: readonly Row[], columns: readonly TableColumn<Row>[], query: string): Row[] {
  const needle = query.trim().toLocaleLowerCase("en-US");
  return rows.filter((row) => !needle || columns.some((column) => column.filterable !== false && displayValue(column.value(row)).toLocaleLowerCase("en-US").includes(needle)));
}

export function DataTable<Row>(props: DataTableProps<Row>) {
  const { title, rows, columns, rowKey, actions = [], filterable = false, loading = false, emptyText = "No entries." } = props;
  const filterId = useId();
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const active = useRef(new Set<string>());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const visible = tableRows(rows, columns, filterable ? query : "");
  if (new Set(actions.map((action) => action.id)).size !== actions.length || actions.some((action) => !action.id.trim())) throw new Error("Table actions require unique, non-empty IDs.");
  const keys = rows.map(rowKey);
  if (new Set(keys).size !== rows.length || keys.some((key) => !key.trim())) throw new Error("Table rows require unique, non-empty keys.");
  if (columns.length === 0 || new Set(columns.map((column) => column.id)).size !== columns.length || columns.some((column) => !column.id.trim())) throw new Error("A table requires columns with unique, non-empty IDs.");
  const layoutColumns = [
    ...columns.map((column) => ({ ...column, id: `data:${column.id}`, flex: column.flex ?? (!columns.some((entry) => entry.flex) && column === columns.at(-1)) })),
    ...(actions.length > 0 ? [{ id: "actions", label: "Actions", width: 180, minWidth: 80, render: (row: Row) => {
      const key = rowKey(row);
      return <>
        <div aria-busy={pending.has(key)} className="flex flex-wrap gap-2">{actions.map((action) => <Button disabled={loading || pending.has(key) || action.disabled?.(row)} key={action.id} onClick={() => void runAction(action, row, key)} size="sm" variant="secondary">{action.label}</Button>)}</div>
        {pending.has(key) && <Badge role="status" tone="active">Running...</Badge>}
        {errors.has(key) && <p className="mt-2 text-sm text-destructive" role="alert">{errors.get(key)}</p>}
      </>;
    } }] : []),
  ];
  const runAction = async (action: TableAction<Row>, row: Row, key: string) => {
    if (loading || active.current.has(key) || action.disabled?.(row)) return;
    active.current.add(key);
    setPending(new Set(active.current));
    setErrors((current) => { const next = new Map(current); next.delete(key); return next; });
    try {
      await action.onClick(row);
    } catch (cause) {
      setErrors((current) => new Map(current).set(key, cause instanceof Error ? cause.message : String(cause)));
    } finally {
      active.current.delete(key);
      setPending(new Set(active.current));
    }
  };
  return (
    <section aria-label={title ?? "Data table"} aria-busy={loading} className="flex min-w-0 flex-col gap-3">
      {title && <h2 className="text-base font-semibold">{title}</h2>}
      {filterable && <SearchInput aria-label="Search table" id={filterId} onValueChange={setQuery} placeholder="Search table" value={query} />}
      {loading && <p className="text-sm text-muted-foreground" role="status">Loading...</p>}
      <DataGrid id={props.id ?? filterId} aria-label={title ?? "Table content"} rows={visible} columns={layoutColumns} rowKey={rowKey}
        selection={props.selectedKeys} onSelectionChange={props.onSelectionChange} loading={loading} emptyText={emptyText} />
    </section>
  );
}
