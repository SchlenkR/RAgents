import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { useRender } from "@base-ui/react/use-render"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { Combobox, ComboboxContent, ComboboxGroup, ComboboxItem, ComboboxLabel, ComboboxSeparator, ComboboxTrigger, dropdownTriggerStyle, matchesOption, optionText } from "./combobox"
import { controlSizes, type ControlSize } from "./control-size"
import { dropdownAnchorWidth, dropdownPanelStyle } from "./dropdown-panel"
import { cn } from "cn"
import { interactionStyle, menuItemStyle } from "./interaction"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"

interface Option {
  readonly value: unknown
  readonly label: React.ReactNode
  readonly text: string
}

const SelectContext = React.createContext<{ searchable: boolean; options: readonly Option[]; equal: (item: unknown, value: unknown) => boolean }>({ searchable: false, options: [], equal: Object.is })

function childOptions(children: React.ReactNode): Option[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement<{ value?: unknown; label?: string; children?: React.ReactNode }>(child)) return []
    if (child.type === SelectItem) return [{ value: child.props.value, label: child.props.children, text: child.props.label ?? optionText(child.props.children) }]
    return childOptions(child.props.children)
  })
}

function listedOptions(items: SelectPrimitive.Root.Props<unknown>["items"]): Option[] {
  if (!items) return []
  if (!Array.isArray(items)) return Object.entries(items).map(([value, label]) => ({ value, label, text: optionText(label) }))
  return items.flatMap((item) => "items" in item ? listedOptions(item.items) : [{ value: item.value, label: item.label, text: optionText(item.label) }])
}

function Select<Value, Multiple extends boolean | undefined = false>({ searchable, children, items, onOpenChange, onValueChange, ...props }: SelectPrimitive.Root.Props<Value, Multiple> & { searchable?: boolean }) {
  const [selected, setSelected] = React.useState<SelectPrimitive.Root.Props<Value, Multiple>["value"]>(props.defaultValue ?? (props.multiple ? [] : null) as SelectPrimitive.Root.Props<Value, Multiple>["value"])
  const [opened, setOpened] = React.useState(props.defaultOpen ?? false)
  const change: SelectPrimitive.Root.Props<Value, Multiple>["onValueChange"] = (value, details) => {
    onValueChange?.(value, details)
    if (!details.isCanceled) setSelected(value)
  }
  const openChanged: SelectPrimitive.Root.Props<Value, Multiple>["onOpenChange"] = (open, details) => {
    onOpenChange?.(open, details)
    if (!details.isCanceled) setOpened(open)
  }
  const state = { ...props, value: props.value === undefined ? selected : props.value, open: props.open ?? opened }
  const rendered = childOptions(children)
  const listed = listedOptions(items)
  const options = listed.length ? listed.map((option) => {
    const item = rendered.find((entry) => Object.is(entry.value, option.value))
    return { ...option, text: item?.text ?? option.text }
  }) : rendered
  const search = searchable ?? options.length > 8
  const equal = (item: unknown, value: unknown) => (props.isItemEqualToValue ?? Object.is)(item as Value, value as Value)
  return <SelectContext.Provider value={{ searchable: search, options, equal }}>
    {search ? <Combobox<Value, Multiple> {...state} items={options.map((option) => option.value)}
      itemToStringLabel={(value) => options.find((option) => (props.isItemEqualToValue ?? Object.is)(option.value as Value, value))?.text ?? props.itemToStringLabel?.(value) ?? String(value)}
      filter={(value, query) => matchesOption(options.find((option) => Object.is(option.value, value))?.text ?? String(value), query)}
      onOpenChange={(open, details) => openChanged(open, details as SelectPrimitive.Root.ChangeEventDetails)}
      onValueChange={(value, details) => change(value, details as SelectPrimitive.Root.ChangeEventDetails)}>{children}</Combobox>
      : <SelectPrimitive.Root {...state} items={items} onOpenChange={openChanged} onValueChange={change}>{children}</SelectPrimitive.Root>}
  </SelectContext.Provider>
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  const context = React.useContext(SelectContext)
  if (context.searchable) return <ComboboxGroup className={className} {...props} />
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SearchSelectValue({ value, placeholder, children, className, render, ref, ...props }: SelectPrimitive.Value.Props & { value: unknown }) {
  const context = React.useContext(SelectContext)
  const label = (entry: unknown) => context.options.find((option) => context.equal(option.value, entry))?.label ?? String(entry)
  const empty = value === null || value === undefined || (Array.isArray(value) && value.length === 0)
  return useRender({ defaultTagName: "span", render, ref, state: { value, placeholder: empty },
    props: { ...props, "data-slot": "select-value", className: cn("min-w-0 flex-1 truncate text-left", typeof className === "function" ? className({ value, placeholder: empty }) : className),
      children: typeof children === "function" ? children(value) : children ?? (empty ? placeholder : Array.isArray(value) ? value.map(label).reduce<React.ReactNode[]>((labels, item, index) => [...labels, ...(index ? [", "] : []), item], []) : label(value)) } })
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  const context = React.useContext(SelectContext)
  if (context.searchable) return <ComboboxPrimitive.Value>{(value) => <SearchSelectValue {...props} className={className} value={value} />}</ComboboxPrimitive.Value>
  return <SelectPrimitive.Value data-slot="select-value" className={cn("min-w-0 flex-1 truncate text-left", className)} {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  render,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: ControlSize
}) {
  const context = React.useContext(SelectContext)
  if (context.searchable) return <ComboboxPrimitive.Value>{(value) => <ComboboxTrigger data-slot="select-trigger" size={size}
    className={typeof className === "function" ? (state) => className({ ...state, value }) : className}
    render={typeof render === "function" ? (elementProps, state) => render(elementProps, { ...state, value }) : render}
    {...props as ComboboxPrimitive.Trigger.Props}>{children}</ComboboxTrigger>}</ComboboxPrimitive.Value>
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      render={render}
      className={cn(
        interactionStyle,
        dropdownTriggerStyle,
        controlSizes[size],
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = false,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  void alignItemWithTrigger
  const context = React.useContext(SelectContext)
  if (context.searchable) return <ComboboxContent data-slot="select-content" align={align} alignOffset={alignOffset} side={side} sideOffset={sideOffset}
    className={typeof className === "function" ? (state) => className(state) : className} {...props as ComboboxPrimitive.Popup.Props}>{children}</ComboboxContent>
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={false}
        className="isolate z-[110]"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={false}
          className={cn(dropdownPanelStyle, dropdownAnchorWidth, "relative isolate z-[110] max-h-(--available-height) w-auto max-w-(--available-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  const context = React.useContext(SelectContext)
  if (context.searchable) return <ComboboxLabel className={className} {...props} />
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  const context = React.useContext(SelectContext)
  if (context.searchable) return <ComboboxItem data-slot="select-item" className={className} {...props as ComboboxPrimitive.Item.Props & { label?: string }}>{children}</ComboboxItem>
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        menuItemStyle,
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  const context = React.useContext(SelectContext)
  if (context.searchable) return <ComboboxSeparator className={className} {...props} />
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  const context = React.useContext(SelectContext)
  if (context.searchable) return null
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon
      />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  const context = React.useContext(SelectContext)
  if (context.searchable) return null
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon
      />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
