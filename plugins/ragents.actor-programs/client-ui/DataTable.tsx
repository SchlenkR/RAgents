import React, { useId, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { Button, Checkbox, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../apps/web/src/ui";
import type { DataTableProps, TableAction, TableColumn, TableValue } from "./table-contracts";

export type TableSort = { id: string; direction: "asc" | "desc" };
const displayValue = (value: TableValue) => value === null || value === undefined ? "" : typeof value === "boolean" ? value ? "Ja" : "Nein" : String(value);

export function tableRows<Row>(rows: readonly Row[], columns: readonly TableColumn<Row>[], query: string, sort?: TableSort): Row[] {
  const needle = query.trim().toLocaleLowerCase("de-DE");
  const filtered = rows.filter((row) => !needle || columns.some((column) => column.filterable !== false && displayValue(column.value(row)).toLocaleLowerCase("de-DE").includes(needle)));
  const column = sort && columns.find((entry) => entry.id === sort.id && entry.sortable);
  if (!column || !sort) return filtered;
  return filtered.sort((left, right) => {
    const a = column.value(left);
    const b = column.value(right);
    if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
    if (b === null || b === undefined) return -1;
    const order = typeof a === "number" && typeof b === "number" ? a - b
      : typeof a === "boolean" && typeof b === "boolean" ? Number(a) - Number(b)
      : String(a).localeCompare(String(b), "de-DE", { numeric: true });
    return sort.direction === "asc" ? order : -order;
  });
}

export function DataTable<Row>(props: DataTableProps<Row>) {
  const { title, rows, columns, rowKey, actions = [], filterable = false, loading = false, emptyText = "Keine Einträge." } = props;
  const filterId = useId();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TableSort>();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const active = useRef(new Set<string>());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const visible = tableRows(rows, columns, filterable ? query : "", sort);
  const selected = new Set(props.selectedKeys);
  const selectable = props.onSelectionChange !== undefined;
  const keys = rows.map(rowKey);
  if (new Set(keys).size !== rows.length || keys.some((key) => !key.trim())) throw new Error("Tabellenzeilen benötigen eindeutige, nicht leere Schlüssel.");
  if (columns.length === 0 || new Set(columns.map((column) => column.id)).size !== columns.length || columns.some((column) => !column.id.trim())) throw new Error("Eine Tabelle benötigt Spalten mit eindeutigen, nicht leeren IDs.");
  if (new Set(actions.map((action) => action.id)).size !== actions.length || actions.some((action) => !action.id.trim())) throw new Error("Tabellenaktionen benötigen eindeutige, nicht leere IDs.");
  const visibleKeys = visible.map(rowKey);
  const allSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));
  const partiallySelected = !allSelected && visibleKeys.some((key) => selected.has(key));
  const toggleVisible = () => {
    const next = new Set(selected);
    for (const key of visibleKeys) { if (allSelected) next.delete(key); else next.add(key); }
    props.onSelectionChange?.([...next]);
  };
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
    <section aria-label={title ?? "Datentabelle"} aria-busy={loading} className="flex min-w-0 flex-col gap-3">
      {title && <h2 className="text-base font-semibold">{title}</h2>}
      {filterable && <Input aria-label="Tabelle durchsuchen" id={filterId} onChange={(event) => setQuery(event.target.value)} placeholder="Tabelle durchsuchen" type="search" value={query} />}
      {loading && <p className="text-sm text-muted-foreground" role="status">Wird geladen ...</p>}
      <div aria-label={title ?? "Tabelleninhalt"} className="max-w-full overflow-auto" role="region" tabIndex={0}>
        <Table>
          <TableHeader><TableRow>
            {selectable && <TableHead className="w-8"><Checkbox aria-label="Alle sichtbaren Zeilen auswählen" checked={allSelected} disabled={loading || visible.length === 0} indeterminate={partiallySelected} onCheckedChange={toggleVisible} /></TableHead>}
            {columns.map((column) => <TableHead aria-sort={sort?.id === column.id ? sort.direction === "asc" ? "ascending" : "descending" : undefined} key={column.id}>
              {column.sortable
                ? <Button className="-ml-2 h-7 gap-1 px-2 font-medium" onClick={() => setSort((current) => current?.id === column.id && current.direction === "asc" ? { id: column.id, direction: "desc" } : { id: column.id, direction: "asc" })} size="sm" variant="ghost">
                  {column.label}{sort?.id === column.id && (sort.direction === "asc" ? <ArrowUpIcon aria-hidden="true" /> : <ArrowDownIcon aria-hidden="true" />)}
                </Button>
                : column.label}
            </TableHead>)}
            {actions.length > 0 && <TableHead>Aktionen</TableHead>}
          </TableRow></TableHeader>
          <TableBody>
            {visible.map((row) => {
              const key = rowKey(row);
              return <TableRow aria-selected={selectable ? selected.has(key) : undefined} data-state={selectable && selected.has(key) ? "selected" : undefined} key={key}>
                {selectable && <TableCell><Checkbox aria-label={`Zeile ${key} auswählen`} checked={selected.has(key)} disabled={loading} onCheckedChange={() => { const next = new Set(selected); if (next.has(key)) next.delete(key); else next.add(key); props.onSelectionChange?.([...next]); }} /></TableCell>}
                {columns.map((column) => <TableCell className="align-top break-words whitespace-normal" key={column.id}>{column.render ? column.render(row) : displayValue(column.value(row))}</TableCell>)}
                {actions.length > 0 && <TableCell className="align-top">
                  <div aria-busy={pending.has(key)} className="flex flex-wrap gap-1.5">{actions.map((action) => <Button disabled={loading || pending.has(key) || action.disabled?.(row)} key={action.id} onClick={() => void runAction(action, row, key)} size="sm" variant="outline">{action.label}</Button>)}</div>
                  {pending.has(key) && <span className="text-xs text-muted-foreground" role="status">Wird ausgeführt ...</span>}
                  {errors.has(key) && <p className="mt-1.5 text-sm text-destructive" role="alert">{errors.get(key)}</p>}
                </TableCell>}
              </TableRow>;
            })}
            {!loading && visible.length === 0 && <TableRow><TableCell className="text-muted-foreground" colSpan={columns.length + Number(selectable) + Number(actions.length > 0)}>{emptyText}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
