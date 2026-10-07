import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { cn } from "cn"
import { controlRadius, controlSizes, type ControlSize } from "./control-size"
import { dropdownAnchorWidth, dropdownCheckStyle, dropdownChevronStyle, dropdownItemStyle, dropdownLabelStyle, dropdownPanelStyle, dropdownSeparatorStyle } from "./dropdown-panel"
import { Input } from "./input"
import { interactionStyle, menuItemStyle, outlinedControl } from "./interaction"

export const dropdownTriggerStyle = `flex w-fit max-w-full shrink-0 items-center justify-between gap-1.5 border py-0 pr-2 pl-2.5 whitespace-nowrap transition-colors outline-none select-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-placeholder:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 ${outlinedControl}`

const ComboboxContext = React.createContext<{ query: string; anchor: React.RefObject<HTMLButtonElement | null> | undefined }>({ query: "", anchor: undefined })

export function optionText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return optionText(node.props.children)
  return React.Children.toArray(node).map((child) => optionText(child)).join("")
}

export function matchesOption(label: string, query: string): boolean {
  return label.toLocaleLowerCase("en-US").includes(query.trim().toLocaleLowerCase("en-US"))
}

function Combobox<Value, Multiple extends boolean | undefined = false>({ onInputValueChange, onOpenChange, inputValue, defaultInputValue, ...props }: ComboboxPrimitive.Root.Props<Value, Multiple>) {
  const [query, setQuery] = React.useState(String(defaultInputValue ?? ""))
  const anchor = React.useRef<HTMLButtonElement>(null)
  return <ComboboxContext.Provider value={{ query: String(inputValue ?? query), anchor }}>
    <ComboboxPrimitive.Root {...props} inputValue={inputValue ?? query}
      onInputValueChange={(next, details) => { setQuery(next); onInputValueChange?.(next, details) }}
      onOpenChange={(open, details) => {
        onOpenChange?.(open, details)
        if (!details.isCanceled) setQuery("")
      }} />
  </ComboboxContext.Provider>
}

function ComboboxTrigger({ className, size = "default", children, ref, ...props }: ComboboxPrimitive.Trigger.Props & { size?: ControlSize }) {
  const { anchor } = React.useContext(ComboboxContext)
  const setTrigger = React.useCallback((element: HTMLButtonElement | null) => {
    if (anchor) anchor.current = element
    if (typeof ref === "function") return ref(element)
    if (ref) ref.current = element
  }, [anchor, ref])
  return <ComboboxPrimitive.Trigger data-slot="combobox-trigger" data-size={size}
    ref={setTrigger} className={cn(interactionStyle, dropdownTriggerStyle, controlSizes[size], controlRadius[size], className)} {...props}>
    {children}
    <ComboboxPrimitive.Icon className="flex"><ChevronDownIcon className={dropdownChevronStyle[size]} /></ComboboxPrimitive.Icon>
  </ComboboxPrimitive.Trigger>
}

function ComboboxValue(props: ComboboxPrimitive.Value.Props) {
  return <span data-slot="combobox-value" className="min-w-0 flex-1 truncate text-left"><ComboboxPrimitive.Value {...props} /></span>
}

function ComboboxContent({ className, children, searchable = true, emptyText = "No matching options.", footer, side = "bottom", sideOffset = 4, align = "start", alignOffset = 0, ...props }: ComboboxPrimitive.Popup.Props &
  Pick<ComboboxPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset"> & {
    searchable?: boolean
    emptyText?: string
    footer?: React.ReactNode
  }) {
  const input = React.useRef<HTMLInputElement>(null)
  const list = React.useRef<HTMLDivElement>(null)
  const { anchor } = React.useContext(ComboboxContext)
  return <ComboboxPrimitive.Portal>
    <ComboboxPrimitive.Positioner anchor={anchor} side={side} sideOffset={sideOffset} align={align} alignOffset={alignOffset} className="isolate z-[110]">
      <ComboboxPrimitive.Popup data-slot="combobox-content" initialFocus={searchable ? input : list}
        className={cn(dropdownPanelStyle, dropdownAnchorWidth, "flex max-h-(--available-height) max-w-(--available-width) flex-col overflow-hidden outline-none", className)} {...props}>
        {searchable && <div className="shrink-0 border-b border-border p-2">
          <ComboboxPrimitive.Input aria-label="Filter options" placeholder="Filter options ..." ref={input} render={<Input size="sm" />} />
        </div>}
        <ComboboxPrimitive.Empty className="px-2.5 text-sm text-muted-foreground not-empty:py-2" role="status">{emptyText}</ComboboxPrimitive.Empty>
        <ComboboxPrimitive.List ref={list} className="min-h-0 overflow-y-auto overscroll-contain p-1">{children}</ComboboxPrimitive.List>
        {footer}
      </ComboboxPrimitive.Popup>
    </ComboboxPrimitive.Positioner>
  </ComboboxPrimitive.Portal>
}

function ComboboxItem({ className, children, label, indicator = "check", ...props }: ComboboxPrimitive.Item.Props & { label?: string; indicator?: "check" | "checkbox" }) {
  const { query } = React.useContext(ComboboxContext)
  if (!matchesOption(label ?? optionText(children), query)) return null
  return <ComboboxPrimitive.Item data-slot="combobox-item" className={cn(menuItemStyle, dropdownItemStyle,
    "relative flex w-full cursor-default items-center outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50", className)} {...props}>
    {indicator === "checkbox" && <span aria-hidden className="flex size-4 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.5)] border border-border-strong bg-background in-data-selected:border-primary in-data-selected:bg-primary in-data-selected:text-primary-foreground">
      <ComboboxPrimitive.ItemIndicator><CheckIcon className="size-3" /></ComboboxPrimitive.ItemIndicator>
    </span>}
    <span className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap">{children}</span>
    {indicator === "check" && <ComboboxPrimitive.ItemIndicator className="ml-auto flex size-4 shrink-0 items-center justify-center"><CheckIcon className={dropdownCheckStyle} /></ComboboxPrimitive.ItemIndicator>}
  </ComboboxPrimitive.Item>
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return <ComboboxPrimitive.Group data-slot="combobox-group" className={cn("scroll-my-1", className)} {...props} />
}

function ComboboxLabel({ className, ...props }: ComboboxPrimitive.GroupLabel.Props) {
  return <ComboboxPrimitive.GroupLabel data-slot="combobox-label" className={cn(dropdownLabelStyle, className)} {...props} />
}

function ComboboxSeparator({ className, ...props }: ComboboxPrimitive.Separator.Props) {
  return <ComboboxPrimitive.Separator data-slot="combobox-separator" className={cn("pointer-events-none", dropdownSeparatorStyle, className)} {...props} />
}

export { Combobox, ComboboxContent, ComboboxGroup, ComboboxItem, ComboboxLabel, ComboboxSeparator, ComboboxTrigger, ComboboxValue }
