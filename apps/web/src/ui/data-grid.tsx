import * as React from "react";
import { cn } from "cn";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { flexRender, getCoreRowModel, getExpandedRowModel, getGroupedRowModel, getSortedRowModel, useReactTable, type Column, type Row, type RowSelectionState, type Updater } from "@tanstack/react-table";
import { useVirtualizer, useWindowVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { interactionStyle } from "./interaction";
import { displayGridValue, gridColumnDefinitions, gridColumnSizes, type DataGridValue } from "./data-grid-model";
import { gridWidthSetting, gridWidthsKey, type GridWidthSetting } from "./data-grid-storage";
import type { TableColumnWidths } from "./table-widths";

export type { DataGridValue } from "./data-grid-model";

export interface DataGridSort {
  id: string;
  desc: boolean;
}

export interface DataGridColumn<T> {
  id: string;
  label: string;
  value?: (row: T) => DataGridValue;
  render?: (row: T) => React.ReactNode;
  width?: number;
  minWidth?: number;
  resizable?: boolean;
  sortable?: boolean;
  wrap?: boolean;
  flex?: boolean;
}

export interface DataGridProps<T> {
  id: string;
  "aria-label": string;
  rows: readonly T[];
  columns: readonly DataGridColumn<T>[];
  rowKey: (row: T) => string;
  stickyOffset?: number;
  height?: number | string;
  sorting?: DataGridSort[];
  defaultSorting?: DataGridSort[];
  onSortingChange?: (sorting: DataGridSort[]) => void;
  grouping?: string[];
  selection?: readonly string[];
  onSelectionChange?: (keys: string[]) => void;
  onRowClick?: (row: T) => void;
  onOpen?: (row: T) => void;
  onEndReached?: () => void;
  endReachedThreshold?: number;
  loading?: boolean;
  footer?: React.ReactNode;
  emptyText?: string;
  className?: string;
}

export function DataGrid<T>(props: DataGridProps<T>) {
  if (!props.id.trim()) throw new Error("A data grid requires a non-empty grid ID.");
  return <GridStorageBoundary key={props.id} gridProps={props} />;
}

class GridStorageBoundary<T> extends React.Component<{ gridProps: DataGridProps<T> }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: unknown) {
    if (!(error instanceof DOMException) || error.name !== "SecurityError") throw error;
    return { error: `Could not read grid column widths: ${String(error)}` };
  }
  render() {
    return this.state.error
      ? <GridLayout {...this.props.gridProps} stored={{ widths: {}, error: this.state.error }} onRetry={() => this.setState({ error: undefined })} />
      : <StoredGrid {...this.props.gridProps} />;
  }
}

function StoredGrid<T>(props: DataGridProps<T>) {
  const stored = gridWidthSetting.useValue(gridWidthsKey(props.id));
  return <GridLayout {...props} stored={stored} />;
}

type GridVirtualizer = Virtualizer<HTMLElement, HTMLDivElement> | Virtualizer<Window, HTMLDivElement>;
const isWindow = (element: HTMLElement | Window | null): element is Window => element !== null && "window" in element;
const emptyGrouping: string[] = [];
const rowSelector = '[data-slot="data-grid-row"]';

function GridLayout<T>({ stored, onRetry, columns, rows, rowKey, grouping, ...props }: DataGridProps<T> & { stored: GridWidthSetting; onRetry?: () => void }) {
  const root = React.useRef<HTMLDivElement>(null);
  const body = React.useRef<HTMLDivElement>(null);
  const header = React.useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = React.useState<HTMLElement | Window | null>(null);
  const [geometry, setGeometry] = React.useState({ width: 0, margin: 0, header: 36 });
  const [draftWidths, setDraftWidths] = React.useState<TableColumnWidths>({});
  const [writeError, setWriteError] = React.useState<string>();
  const [internalSorting, setInternalSorting] = React.useState<DataGridSort[]>(props.defaultSorting ?? []);
  const [internalSelection, setInternalSelection] = React.useState<RowSelectionState>({});
  const [focusedId, setFocusedId] = React.useState<string>();
  const pendingFocus = React.useRef<string | null>(null);
  const reached = React.useRef<string | null>(null);
  const sorting = props.sorting ?? internalSorting;
  const selectable = props.selection !== undefined || props.onSelectionChange !== undefined;
  const selection = React.useMemo(() => props.selection === undefined ? internalSelection : Object.fromEntries(props.selection.map((id) => [id, true])), [props.selection, internalSelection]);
  const definitions = React.useMemo(() => gridColumnDefinitions(columns), [columns]);
  const data = React.useMemo(() => [...rows], [rows]);
  React.useMemo(() => {
    const keys = rows.map(rowKey);
    if (keys.some((key) => !key.trim()) || new Set(keys).size !== keys.length) throw new Error("Data grid rows require unique, non-empty keys.");
    if (grouping?.some((id) => !columns.some((column) => column.id === id && column.value))) throw new Error("Grid grouping requires a value column.");
  }, [rows, rowKey, grouping, columns]);
  const changeSorting = (update: Updater<DataGridSort[]>) => {
    const next = typeof update === "function" ? update(sorting) : update;
    if (props.sorting === undefined) setInternalSorting(next);
    props.onSortingChange?.(next);
  };
  const changeSelection = (update: Updater<RowSelectionState>) => {
    const next = typeof update === "function" ? update(selection) : update;
    if (props.selection === undefined) setInternalSelection(next);
    props.onSelectionChange?.(Object.keys(next).filter((id) => next[id]));
  };
  const widths = gridColumnSizes(columns, { ...stored.widths, ...draftWidths }, geometry.width, selectable ? 40 : 0);
  const table = useReactTable({
    data, columns: definitions, getRowId: rowKey,
    state: { sorting, grouping: grouping ?? emptyGrouping, rowSelection: selection, columnSizing: widths },
    initialState: { expanded: true },
    onSortingChange: changeSorting, onRowSelectionChange: changeSelection,
    onColumnSizingChange: (update) => setDraftWidths((current) => typeof update === "function" ? update({ ...stored.widths, ...current }) : update),
    columnResizeMode: "onChange", autoResetExpanded: false, autoResetPageIndex: false, enableRowSelection: selectable, groupedColumnMode: false,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    getGroupedRowModel: getGroupedRowModel(), getExpandedRowModel: getExpandedRowModel(),
  });
  const visible = table.getRowModel().rows;
  const getItemKey = React.useCallback((index: number) => visible[index].id, [visible]);
  const stickyOffset = props.height === undefined ? props.stickyOffset ?? 0 : 0;
  const virtualOptions = {
    count: visible.length, getItemKey, estimateSize: () => 36, overscan: 8,
    scrollMargin: geometry.margin, scrollPaddingStart: stickyOffset + geometry.header,
    initialRect: { width: 0, height: 900 },
  };
  const pageVirtualizer = useWindowVirtualizer<HTMLDivElement>({ ...virtualOptions, enabled: scrollElement === null || isWindow(scrollElement) });
  const panelVirtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    ...virtualOptions, enabled: scrollElement !== null && !isWindow(scrollElement),
    getScrollElement: () => isWindow(scrollElement) ? null : scrollElement,
  });
  const virtualizer: GridVirtualizer = isWindow(scrollElement) || scrollElement === null ? pageVirtualizer : panelVirtualizer;
  React.useLayoutEffect(() => {
    const grid = root.current!;
    const browser = grid.ownerDocument.defaultView!;
    let target: HTMLElement | Window = props.height !== undefined ? grid : browser;
    let blockedSticky = false;
    if (props.height === undefined) for (let parent = grid.parentElement; parent; parent = parent.parentElement) {
      const overflow = browser.getComputedStyle(parent).overflowY;
      if (/(auto|scroll|overlay)/.test(overflow) && parent.scrollHeight > parent.clientHeight) { target = parent; break; }
      if (/(auto|scroll|overlay|hidden)/.test(overflow)) blockedSticky = true;
    }
    setScrollElement(target);
    const sticky = header.current!;
    const syncHeader = () => {
      if (!blockedSticky) return;
      const viewportTop = isWindow(target) ? 0 : target.getBoundingClientRect().top + target.clientTop;
      const top = body.current!.getBoundingClientRect().top - sticky.getBoundingClientRect().height;
      const offset = Math.max(0, Math.min(body.current!.getBoundingClientRect().height, viewportTop + (props.stickyOffset ?? 0) - top));
      sticky.style.transform = `translateY(${offset}px)`;
    };
    if (blockedSticky) { sticky.style.position = "relative"; sticky.style.top = "0px"; target.addEventListener("scroll", syncHeader, { passive: true }); }
    const measure = () => {
      const rect = body.current!.getBoundingClientRect();
      const margin = isWindow(target) ? rect.top + target.scrollY : rect.top - target.getBoundingClientRect().top - target.clientTop + target.scrollTop;
      const next = { width: grid.clientWidth, margin, header: header.current!.getBoundingClientRect().height };
      setGeometry((current) => current.width === next.width && current.margin === next.margin && current.header === next.header ? current : next);
      syncHeader();
    };
    const observer = new ResizeObserver(measure);
    for (let element: HTMLElement | null = grid; element; element = element.parentElement) {
      observer.observe(element);
      for (const sibling of element.parentElement?.children ?? []) if (sibling !== element) observer.observe(sibling);
    }
    measure();
    browser.addEventListener("resize", measure);
    return () => {
      observer.disconnect(); browser.removeEventListener("resize", measure); target.removeEventListener("scroll", syncHeader);
      if (blockedSticky) { sticky.style.position = ""; sticky.style.top = `${props.height === undefined ? props.stickyOffset ?? 0 : 0}px`; sticky.style.transform = ""; }
    };
  }, [props.height, props.stickyOffset, visible.length]);
  const template = [...(selectable ? ["40px"] : []), ...columns.map((column) => `${widths[column.id]}px`)].join(" ");
  const contentWidth = Object.values(widths).reduce((sum, width) => sum + width, selectable ? 40 : 0);
  const items = virtualizer.getVirtualItems();
  const itemsSignature = items.map((item) => `${item.index}:${item.start}:${item.size}`).join(",");
  React.useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const row = [...(body.current?.querySelectorAll<HTMLElement>(rowSelector) ?? [])].find((element) => element.dataset.rowId === pendingFocus.current);
    if (row) { row.focus({ preventScroll: true }); pendingFocus.current = null; }
  }, [itemsSignature]);
  const { onEndReached, loading, endReachedThreshold } = props;
  React.useEffect(() => {
    if (!onEndReached || loading || !scrollElement) return;
    const check = () => {
      const end = geometry.margin + virtualizer.getTotalSize();
      const viewportEnd = isWindow(scrollElement) ? scrollElement.scrollY + scrollElement.innerHeight : scrollElement.scrollTop + scrollElement.clientHeight;
      if (end - viewportEnd > (endReachedThreshold ?? 200)) return;
      const boundary = `${rows.length}:${rows.length ? rowKey(rows[rows.length - 1]) : ""}`;
      if (reached.current !== boundary) { reached.current = boundary; onEndReached(); }
    };
    check();
    scrollElement.addEventListener("scroll", check, { passive: true });
    return () => scrollElement.removeEventListener("scroll", check);
  }, [onEndReached, loading, endReachedThreshold, scrollElement, geometry, rows, rowKey, virtualizer, itemsSignature]);
  const saveWidth = (id: string, width: number) => {
    try {
      gridWidthSetting.save(gridWidthsKey(props.id), { widths: { ...stored.widths, [id]: width } });
      setWriteError(undefined);
    } catch (error) { setWriteError(`Could not save grid column widths: ${String(error)}`); }
    setDraftWidths({});
  };
  const fit = (column: DataGridColumn<T>) => {
    let width = column.minWidth ?? 64;
    for (const cell of root.current!.querySelectorAll<HTMLElement>("[data-grid-column]")) {
      if (cell.dataset.gridColumn !== column.id) continue;
      const content = cell.querySelector<HTMLElement>('[data-slot="data-grid-cell-content"]');
      if (!content) continue;
      const sample = content.cloneNode(true) as HTMLElement;
      Object.assign(sample.style, { position: "absolute", visibility: "hidden", width: "max-content", maxWidth: "none", whiteSpace: "nowrap" });
      cell.append(sample);
      width = Math.max(width, sample.getBoundingClientRect().width + 24);
      sample.remove();
    }
    saveWidth(column.id, Math.ceil(width));
  };
  const focusRow = (index: number) => {
    const row = visible[Math.max(0, Math.min(visible.length - 1, index))];
    if (!row) return;
    pendingFocus.current = row.id;
    setFocusedId(row.id);
    virtualizer.scrollToIndex(visible.indexOf(row), { align: "auto" });
    const mounted = [...(body.current?.querySelectorAll<HTMLElement>(rowSelector) ?? [])].find((element) => element.dataset.rowId === row.id);
    if (mounted) { mounted.focus({ preventScroll: true }); pendingFocus.current = null; }
  };
  const error = stored.error ?? writeError;
  return <div className={cn("min-w-0 w-full", props.height !== undefined && "relative overflow-auto", props.className)} style={{ height: props.height }} ref={root}>
    {error && <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
      <span>{error}</span><Button variant="link" size="sm" onClick={() => {
        if (onRetry) { onRetry(); return; }
        try { gridWidthSetting.save(gridWidthsKey(props.id), { widths: {} }); setWriteError(undefined); }
        catch (cause) { setWriteError(`Could not reset grid column widths: ${String(cause)}`); }
      }}>{onRetry ? "Retry column widths" : "Reset column widths"}</Button>
    </div>}
    <div role="grid" id={props.id} aria-label={props["aria-label"]} aria-rowcount={visible.length + 1} aria-colcount={columns.length + Number(selectable)} aria-multiselectable={selectable || undefined} aria-busy={props.loading} data-slot="data-grid" style={{ minWidth: contentWidth }}>
      <div ref={header} role="row" aria-rowindex={1} data-slot="data-grid-header" className="sticky z-20 grid border-b border-border-soft bg-background type-label text-muted-foreground" style={{ top: stickyOffset, gridTemplateColumns: template }}>
        {selectable && <div role="columnheader" className="flex items-center justify-center"><Checkbox aria-label="Select all rows" checked={table.getIsAllRowsSelected()} indeterminate={table.getIsSomeRowsSelected()} disabled={props.loading || rows.length === 0} onCheckedChange={() => table.toggleAllRowsSelected()} /></div>}
        {table.getFlatHeaders().map((head) => {
          const column = columns.find((entry) => entry.id === head.id)!;
          const sorted = head.column.getIsSorted();
          return <div role="columnheader" aria-sort={sorted ? sorted === "asc" ? "ascending" : "descending" : undefined} data-grid-column={column.id} className="relative flex min-w-0 items-center px-2 py-2" key={head.id}>
            <div data-slot="data-grid-cell-content" className="min-w-0 flex-1 truncate" title={column.label}>
              {head.column.getCanSort() ? <button type="button" className={cn("flex w-full items-center gap-1 text-left type-label", interactionStyle)} onClick={head.column.getToggleSortingHandler()}>
                <span className="truncate">{column.label}</span>{sorted && (sorted === "asc" ? <ArrowUpIcon className="size-3 shrink-0" /> : <ArrowDownIcon className="size-3 shrink-0" />)}
              </button> : column.label}
            </div>
            {head.column.getCanResize() && <GridResize column={head.column} preview={(id, width) => setDraftWidths((current) => { const next = { ...current }; if (width === undefined) delete next[id]; else next[id] = width; return next; })} label={column.label} width={widths[column.id]} disabled={Boolean(stored.error)} save={saveWidth} fit={() => fit(column)} />}
          </div>;
        })}
      </div>
      <div ref={body} role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => <GridRow key={item.key} row={visible[item.index]} index={item.index} columns={columns} template={template} virtualizer={virtualizer} start={item.start - geometry.margin}
          selectable={selectable} loading={props.loading} onOpen={props.onOpen} onRowClick={props.onRowClick}
          tabIndex={items.some((entry) => visible[entry.index].id === focusedId) ? visible[item.index].id === focusedId ? 0 : -1 : item.index === items[0]?.index ? 0 : -1}
          onFocus={() => setFocusedId(visible[item.index].id)} onNavigate={focusRow} />)}
      </div>
      {visible.length === 0 && !props.loading && <p className="py-3 text-sm text-muted-foreground">{props.emptyText ?? "No entries."}</p>}
    </div>
    {props.footer && <div data-slot="data-grid-footer" className="py-2 text-sm text-muted-foreground">{props.footer}</div>}
  </div>;
}

function GridResize<T>({ column, preview, label, width, disabled, save, fit }: {
  column: Column<T>; preview: (id: string, width?: number) => void; label: string; width: number; disabled: boolean;
  save: (id: string, width: number) => void; fit: () => void;
}) {
  const drag = React.useRef<{ x: number; width: number; pointer: number } | null>(null);
  const minimum = column.columnDef.minSize ?? 64;
  const draggedWidth = (x: number) => Math.max(minimum, drag.current!.width + x - drag.current!.x);
  return <div role="separator" aria-orientation="vertical" aria-label={`Resize ${label} column`} aria-valuemin={minimum} aria-valuenow={Math.round(width)} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : 0}
    className="absolute inset-y-0 right-0 w-2 touch-none cursor-col-resize hover:bg-selected-border focus-visible:bg-selected-border focus-visible:outline-none"
    onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => { event.stopPropagation(); if (!disabled) fit(); }}
    onKeyDown={(event) => {
      if (disabled) return;
      if (["Enter", "End"].includes(event.key)) { event.preventDefault(); fit(); }
      if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) {
        event.preventDefault();
        save(column.id, event.key === "Home" ? minimum : Math.max(minimum, width + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 50 : 10)));
      }
    }}
    onPointerDown={(event) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      drag.current = { x: event.clientX, width, pointer: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => { if (drag.current?.pointer === event.pointerId) preview(column.id, draggedWidth(event.clientX)); }}
    onPointerUp={(event) => {
      if (drag.current?.pointer !== event.pointerId) return;
      const next = draggedWidth(event.clientX);
      drag.current = null;
      save(column.id, next);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { drag.current = null; preview(column.id); }}
    onLostPointerCapture={() => { if (drag.current) { drag.current = null; preview(column.id); } }} />;
}

function GridRow<T>({ row, index, columns, template, virtualizer, start, selectable, loading, onOpen, onRowClick, tabIndex, onFocus, onNavigate }: {
  row: Row<T>; index: number; columns: readonly DataGridColumn<T>[]; template: string; virtualizer: GridVirtualizer; start: number;
  selectable: boolean; loading?: boolean; onOpen?: (row: T) => void; onRowClick?: (row: T) => void;
  tabIndex: number; onFocus: () => void; onNavigate: (index: number) => void;
}) {
  const grouped = row.getIsGrouped();
  const interactive = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("button,a,input,textarea,select,[role=checkbox]"));
  return <div role="row" data-slot="data-grid-row" data-index={index} data-row-id={row.id} aria-rowindex={index + 2} aria-selected={!grouped && selectable ? row.getIsSelected() : undefined} aria-expanded={grouped ? row.getIsExpanded() : undefined}
    ref={virtualizer.measureElement} tabIndex={tabIndex} onFocus={onFocus}
    className={cn("absolute top-0 left-0 grid min-h-9 w-full border border-transparent border-b-border-soft text-sm", interactionStyle, grouped && "font-medium")}
    style={{ gridTemplateColumns: template, transform: `translateY(${start}px)` }}
    onClick={(event) => { if (!interactive(event.target)) { if (grouped) row.toggleExpanded(); else onRowClick?.(row.original); } }}
    onDoubleClick={(event) => { if (!grouped && !interactive(event.target)) onOpen?.(row.original); }}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? virtualizer.options.count - 1 : undefined;
      if (next !== undefined) { event.preventDefault(); onNavigate(next); }
      if (grouped && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); row.toggleExpanded(event.key === "ArrowRight"); }
      if (event.key === "Enter") { event.preventDefault(); if (grouped) row.toggleExpanded(); else onOpen?.(row.original); }
      if (event.key === " ") { event.preventDefault(); if (grouped) row.toggleExpanded(); else if (selectable && !loading) row.toggleSelected(); }
    }}>
    {grouped ? <div role="gridcell" aria-colspan={columns.length + Number(selectable)} className="col-span-full flex min-w-0 items-center gap-2 px-2 py-2" style={{ paddingLeft: 8 + row.depth * 16 }}>
      <button type="button" aria-label={`${row.getIsExpanded() ? "Collapse" : "Expand"} ${displayGridValue(row.getValue(row.groupingColumnId!))}`} onClick={() => row.toggleExpanded()} className={cn("flex min-w-0 items-center gap-2", interactionStyle)}>
        {row.getIsExpanded() ? <ChevronDownIcon className="size-3.5 shrink-0" /> : <ChevronRightIcon className="size-3.5 shrink-0" />}
        <span className="truncate" title={displayGridValue(row.getValue(row.groupingColumnId!))}>{displayGridValue(row.getValue(row.groupingColumnId!))}</span><span className="font-mono type-meta text-muted-foreground">{row.getLeafRows().length}</span>
      </button>
    </div> : <>
      {selectable && <div role="gridcell" className="flex items-start justify-center py-2"><Checkbox aria-label={`Select row ${row.id}`} checked={row.getIsSelected()} disabled={loading} onCheckedChange={() => row.toggleSelected()} /></div>}
      {row.getVisibleCells().map((cell, columnIndex) => <GridCell key={cell.id} column={columns[columnIndex]}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</GridCell>)}
    </>}
  </div>;
}

function GridCell<T>({ column, children }: { column: DataGridColumn<T>; children: React.ReactNode }) {
  const content = React.useRef<HTMLDivElement>(null);
  const [text, setText] = React.useState<string>();
  React.useEffect(() => { setText(content.current?.textContent ?? undefined); }, [children]);
  return <div role="gridcell" data-grid-column={column.id} className="min-w-0 px-2 py-2">
    <div ref={content} data-slot="data-grid-cell-content" title={text} className={column.wrap ? "whitespace-normal break-words" : "truncate"}>{children}</div>
  </div>;
}
