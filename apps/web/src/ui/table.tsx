import * as React from "react"
import { cn } from "cn"
import { Button } from "./button"
import { createLocalStorageSetting } from "../lib/local-storage-setting"
import { parseTableColumnWidths, tableColumnMinimum, tableColumnWidth, tableWidthsKey, validateTableColumns, type TableColumnDefinition, type TableColumnWidths } from "./table-widths"

export type TableProps = React.ComponentProps<"table"> & { columns?: readonly TableColumnDefinition[] }
type ResizableTableProps = TableProps & { id: string; columns: readonly TableColumnDefinition[] }
type WidthSetting = { widths: TableColumnWidths; error?: string }

const widthSetting = createLocalStorageSetting<WidthSetting>({
  changeEvent: "ragents-table-widths-change",
  matchesKey: (key) => key.startsWith("ragents.table.widths:"),
  parse: (raw) => {
    try { return { widths: parseTableColumnWidths(raw) } }
    catch (error) { return { widths: {}, error: `Could not read table column widths: ${String(error)}` } }
  },
  serialize: ({ widths }) => {
    const raw = JSON.stringify(widths)
    parseTableColumnWidths(raw)
    return raw
  },
})

export const tableRowMin = "[--grid-row-min:calc(var(--spacing)_*_5.5_+_var(--grid-cell-y)_*_2_+_1px)]";

export const tableHeadStyle = "px-(--grid-cell-x) py-[calc(var(--grid-cell-y)*0.8)] text-[0.71rem] leading-snug font-semibold text-muted-foreground aria-[sort=ascending]:text-foreground aria-[sort=descending]:text-foreground"

export const tableRowStyle = "border-b border-border outline-none hover:bg-hover/50 hover:text-hover-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset selected:bg-selected selected:text-selected-foreground selected:shadow-[inset_0_0_0_1px_var(--selected-border)] selected:hover:bg-selected-hover selected:hover:text-selected-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"

export const tableResizeStyle = "absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-[28%] after:right-0 after:w-px after:bg-border group-last/column:not-hover:not-focus-visible:after:bg-transparent hover:after:inset-y-1 hover:after:w-0.5 hover:after:bg-ring focus-visible:after:inset-y-1 focus-visible:after:w-0.5 focus-visible:after:bg-ring"

type TableResizeContext = {
  columns: readonly TableColumnDefinition[]
  widths: TableColumnWidths
  disabled: boolean
  preview: (id: string, width?: number) => void
  save: (id: string, width: number) => void
  table: React.RefObject<HTMLTableElement | null>
}
const ResizeContext = React.createContext<TableResizeContext | null>(null)

function Table({ columns, ...props }: TableProps) {
  if (columns) {
    if (!props.id?.trim()) throw new Error("A resizable table requires a non-empty table ID.")
    validateTableColumns(columns)
    return <TableStorageBoundary key={props.id} tableProps={{ ...props, columns, id: props.id }} />
  }
  return <TableSurface {...props} />
}

class TableStorageBoundary extends React.Component<{ tableProps: ResizableTableProps }, { error?: string }> {
  state: { error?: string } = {}
  static getDerivedStateFromError(error: unknown) {
    if (!(error instanceof DOMException) || error.name !== "SecurityError") throw error
    return { error: `Could not read table column widths: ${String(error)}` }
  }
  render() {
    return this.state.error
      ? <TableLayout {...this.props.tableProps} stored={{ widths: {}, error: this.state.error }} onRetry={() => this.setState({ error: undefined })} />
      : <ResizableTable {...this.props.tableProps} />
  }
}

function ResizableTable(props: ResizableTableProps) {
  const stored = widthSetting.useValue(tableWidthsKey(props.id))
  return <TableLayout {...props} stored={stored} />
}

function TableLayout({ id, columns, style, stored, onRetry, ref, ...props }: ResizableTableProps & { stored: WidthSetting; onRetry?: () => void }) {
  const key = tableWidthsKey(id)
  const [previewWidths, setPreviewWidths] = React.useState<TableColumnWidths>({})
  const [writeError, setWriteError] = React.useState<string>()
  const table = React.useRef<HTMLTableElement>(null)
  React.useImperativeHandle(ref, () => table.current!)
  const widths = { ...stored.widths, ...previewWidths }
  const preview = (columnId: string, width?: number) => setPreviewWidths((current) => {
    const next = { ...current }
    if (width === undefined) delete next[columnId]
    else next[columnId] = width
    return next
  })
  const save = (columnId: string, width: number) => {
    try {
      widthSetting.save(key, { widths: { ...stored.widths, [columnId]: width } })
      setWriteError(undefined)
    } catch (error) { setWriteError(`Could not save table column widths: ${String(error)}`) }
    preview(columnId)
  }
  const error = stored.error ?? writeError
  return <ResizeContext value={{ columns, widths, preview, save, table, disabled: Boolean(stored.error) }}>
    {error && <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
      <span>{error}</span>
      <Button type="button" size="sm" variant="link" onClick={() => {
        if (onRetry) { onRetry(); return }
        try { widthSetting.save(key, { widths: {} }); setWriteError(undefined) }
        catch (cause) { setWriteError(`Could not reset table column widths: ${String(cause)}`) }
      }}>{onRetry ? "Retry column widths" : "Reset column widths"}</Button>
    </div>}
    <TableSurface {...props} id={id} ref={table} data-resizable="true" style={{ ...style, tableLayout: "fixed", width: columns.reduce((total, column) => total + tableColumnWidth(column, widths), 0) }}>
      <colgroup>{columns.map((column) => <col key={column.id} style={{ width: tableColumnWidth(column, widths) }} />)}</colgroup>
      {props.children}
    </TableSurface>
  </ResizeContext>
}

function TableSurface({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm tabular-nums", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-band [&_tr]:border-b [&_tr]:border-border-strong [&_tr]:hover:bg-transparent", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={className}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        tableRowStyle,
        "transition-colors has-[[aria-expanded=true]:not([aria-haspopup])]:border-b-transparent",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, children, columnId, ref, title, ...props }: React.ComponentProps<"th"> & { columnId?: string }) {
  const resize = React.useContext(ResizeContext)
  const columns = resize?.columns
  const head = React.useRef<HTMLTableCellElement>(null)
  const [index, setIndex] = React.useState(-1)
  const [fullText, setFullText] = React.useState<string>()
  React.useImperativeHandle(ref, () => head.current!)
  React.useLayoutEffect(() => {
    if (columns && !columnId && head.current?.colSpan === 1) setIndex(head.current.cellIndex)
  }, [columnId, columns])
  React.useEffect(() => {
    if (columns) setFullText(head.current?.textContent ?? undefined)
  }, [children, columns])
  const column = resize && (columnId ? resize.columns.find((entry) => entry.id === columnId) : resize.columns[index])
  if (resize && columnId && !column) throw new Error(`Unknown table column: ${columnId}`)
  return (
    <th
      ref={head}
      data-slot="table-head"
      className={cn(
        tableHeadStyle,
        "group/column relative text-left align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        resize && "overflow-hidden",
        className
      )}
      {...props}
      title={title ?? fullText}
    >
      {resize ? <div data-slot="table-head-content" className="truncate pr-2">{children}</div> : children}
      {resize && column && column.resizable !== false && <TableResizeHandle column={column} context={resize} />}
    </th>
  )
}

function TableResizeHandle({ column, context }: { column: TableColumnDefinition; context: TableResizeContext }) {
  const drag = React.useRef<{ pointerId: number; x: number; width: number; direction: number } | null>(null)
  const width = tableColumnWidth(column, context.widths)
  const minimum = tableColumnMinimum(column)
  const fit = () => {
    const index = context.columns.findIndex((entry) => entry.id === column.id)
    let fitted = minimum
    for (const row of context.table.current?.rows ?? []) {
      const cell = row.cells[index]
      if (!cell || cell.colSpan !== 1) continue
      const content = cell.querySelector<HTMLElement>('[data-slot="table-cell-content"], [data-slot="table-head-content"]')
      if (!content) continue
      const sample = content.cloneNode(true) as HTMLElement
      Object.assign(sample.style, { width: "max-content", maxWidth: "none", position: "absolute", visibility: "hidden" })
      cell.append(sample)
      const style = getComputedStyle(cell)
      fitted = Math.max(fitted, Math.ceil(sample.getBoundingClientRect().width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2))
      sample.remove()
    }
    context.save(column.id, fitted)
  }
  const draggedWidth = (x: number) => Math.max(minimum, Math.round(drag.current!.width + (x - drag.current!.x) * drag.current!.direction))
  return <span
    role="separator"
    aria-label={`Resize ${column.label ?? column.id} column`}
    aria-orientation="vertical"
    aria-valuemin={minimum}
    aria-valuemax={Math.max(10000, width)}
    aria-valuenow={width}
    aria-disabled={context.disabled || undefined}
    tabIndex={context.disabled ? -1 : 0}
    title="Drag to resize; double-click to fit content"
    className={tableResizeStyle}
    onClick={(event) => event.stopPropagation()}
    onPointerDown={(event) => {
      if (context.disabled || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      drag.current = { pointerId: event.pointerId, x: event.clientX, width, direction: getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1 }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => {
      if (!context.disabled && drag.current?.pointerId === event.pointerId) context.preview(column.id, draggedWidth(event.clientX))
    }}
    onPointerUp={(event) => {
      if (drag.current?.pointerId !== event.pointerId) return
      if (context.disabled) context.preview(column.id)
      else context.save(column.id, draggedWidth(event.clientX))
      drag.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onPointerCancel={() => { drag.current = null; context.preview(column.id) }}
    onLostPointerCapture={() => { if (drag.current) { drag.current = null; context.preview(column.id) } }}
    onDoubleClick={(event) => { event.stopPropagation(); if (!context.disabled) fit() }}
    onKeyDown={(event) => {
      if (context.disabled) return
      if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === "End" || event.key === "Enter") fit()
      else context.save(column.id, event.key === "Home" ? minimum : Math.max(minimum, width + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 50 : 10)))
    }}
  />
}

function TableCell({ className, children, title, ...props }: React.ComponentProps<"td">) {
  const resizing = React.useContext(ResizeContext) !== null
  const content = React.useRef<HTMLDivElement>(null)
  const [fullText, setFullText] = React.useState<string>()
  React.useEffect(() => {
    if (resizing) setFullText(content.current?.textContent ?? undefined)
  }, [children, resizing])
  return (
    <td
      data-slot="table-cell"
      className={cn(
        tableRowMin,
        "h-(--grid-row-min) px-(--grid-cell-x) py-(--grid-cell-y) align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        resizing && "overflow-hidden",
        className
      )}
      {...props}
      title={title ?? fullText}
    >{resizing && (props.colSpan ?? 1) === 1 ? <div ref={content} data-slot="table-cell-content" className="truncate">{children}</div> : children}</td>
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
export type { TableColumnDefinition } from "./table-widths"
