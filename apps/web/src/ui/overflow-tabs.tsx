import type { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cn } from "cn"
import { EllipsisIcon } from "lucide-react"
import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react"
import { Button } from "./button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "./dropdown-menu"
import { splitOverflow, type OverflowMeasure } from "./overflow-split"
import { Tabs, TabsList, TabsTrigger, tabsTriggerClass } from "./tabs"

/** One tab of a strip that moves the tabs that do not fit into a trailing "..." menu. */
export interface OverflowTabItem {
  readonly value: string
  /** The visible text, the accessible name, and the menu entry. */
  readonly label: string
  readonly count?: number
  readonly icon?: ReactNode
  /** The tab's own element ID, for panels the caller renders without TabsContent. */
  readonly id?: string
  /** The element ID of the panel this tab controls, for panels the caller renders without TabsContent. */
  readonly controls?: string
}

export interface OverflowTabsProps extends Omit<TabsPrimitive.Root.Props, "value" | "defaultValue" | "onValueChange"> {
  value: string
  onValueChange: (value: string) => void
}

export interface OverflowTabsListProps {
  items: readonly OverflowTabItem[]
  "aria-label": string
  /** Every tab shows only its icon; the label stays its accessible name and tooltip. */
  iconOnly?: boolean
  className?: string
  listClassName?: string
  triggerClassName?: string
}

const OverflowTabsContext = createContext<Pick<OverflowTabsProps, "value" | "onValueChange"> | null>(null)

/** Tabs with an OverflowTabsList; the panels are TabsContent or the caller's own elements. */
function OverflowTabs({ value, onValueChange, ...props }: OverflowTabsProps) {
  const selection = useMemo(() => ({ value, onValueChange }), [value, onValueChange])
  return <OverflowTabsContext.Provider value={selection}>
    <Tabs onValueChange={(next) => onValueChange(String(next))} value={value} {...props} />
  </OverflowTabsContext.Provider>
}

function TabContent({ item, iconOnly }: { item: OverflowTabItem; iconOnly: boolean }) {
  return <>
    {item.icon}
    {!iconOnly && <span className="min-w-0 truncate">{item.count === undefined ? item.label : `${item.label} ${item.count}`}</span>}
  </>
}

const horizontalInset = (style: CSSStyleDeclaration) => parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
  + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)

const sameMeasure = (left: OverflowMeasure | undefined, right: OverflowMeasure) => left !== undefined
  && left.gap === right.gap && left.inset === right.inset && left.more === right.more && left.available === right.available
  && left.items.length === right.items.length && left.items.every((width, index) => width === right.items[index])

/** A tab list that keeps the active tab visible and moves the tabs that do not fit into a trailing "..." menu instead of clipping or wrapping them. */
function OverflowTabsList({ items, iconOnly = false, className, listClassName, triggerClassName, "aria-label": label }: OverflowTabsListProps) {
  const selection = useContext(OverflowTabsContext)
  if (!selection) throw new Error("OverflowTabsList needs OverflowTabs around it.")
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [list, setList] = useState<HTMLDivElement | null>(null)
  const [ruler, setRuler] = useState<HTMLDivElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const [measure, setMeasure] = useState<OverflowMeasure>()
  const signature = items.map((item) => `${item.value}\u0000${item.label}\u0000${item.count ?? ""}`).join("\u0001")
  useLayoutEffect(() => setMounted(true), [])
  useLayoutEffect(() => {
    if (!container || !list || !ruler) return
    const update = () => {
      const bounds = container.getBoundingClientRect()
      const scale = bounds.width / container.offsetWidth || 1
      const width = (element: Element) => element.getBoundingClientRect().width / scale
      const strip = getComputedStyle(list)
      const outer = getComputedStyle(container)
      const more = ruler.querySelector("[data-overflow-more]")
      const next: OverflowMeasure = {
        items: [...ruler.querySelectorAll("[data-overflow-item]")].map(width),
        gap: parseFloat(strip.columnGap) || 0,
        inset: horizontalInset(strip),
        more: (more ? width(more) : 0) + (parseFloat(outer.columnGap) || 0),
        available: width(container) - horizontalInset(outer),
      }
      setMeasure((current) => sameMeasure(current, next) ? current : next)
    }
    const observer = new ResizeObserver(update)
    observer.observe(container)
    observer.observe(ruler)
    update()
    return () => observer.disconnect()
  }, [container, list, ruler, signature])
  const active = items.findIndex((item) => item.value === selection.value)
  const split = measure?.items.length === items.length ? splitOverflow(measure, active) : undefined
  const shown = split ? split.visible.map((index) => items[index]!) : items
  const hidden = split ? split.hidden.map((index) => items[index]!) : []
  return <div className={cn("relative flex w-full min-w-0 items-center gap-1", className)} data-slot="overflow-tabs" ref={setContainer}>
    <TabsList aria-label={label} className={cn("min-w-0 max-w-full flex-none justify-start", listClassName)} ref={setList} variant="line">
      {shown.map((item) => <TabsTrigger {...(item.id === undefined ? {} : { id: item.id })} {...(item.controls === undefined ? {} : { "aria-controls": item.controls })}
        {...(iconOnly ? { "aria-label": item.label, title: item.label } : {})} className={cn(item.value === selection.value ? "min-w-0 flex-[0_1_auto]" : "flex-none", triggerClassName)}
        key={item.value} value={item.value}><TabContent iconOnly={iconOnly} item={item} /></TabsTrigger>)}
    </TabsList>
    {hidden.length > 0 && <DropdownMenu>
      <DropdownMenuTrigger render={<Button aria-label="More tabs" className="flex-none text-muted-foreground" size="icon-sm" title="More tabs" variant="ghost" />}>
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto max-w-[min(20rem,var(--available-width))]">
        <DropdownMenuRadioGroup onValueChange={(next) => selection.onValueChange(String(next))} value={selection.value}>
          {hidden.map((item) => <DropdownMenuRadioItem key={item.value} value={item.value}>
            {item.icon}
            <span className="min-w-0 truncate">{item.label}</span>
            {item.count !== undefined && <span className="ml-auto tabular-nums text-muted-foreground">{item.count}</span>}
          </DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>}
    {mounted && <div aria-hidden className="pointer-events-none invisible absolute top-0 left-0 size-0 overflow-hidden" inert>
      <div className="flex w-max" ref={setRuler}>
        {items.map((item) => <span className={cn(tabsTriggerClass, "flex-none", triggerClassName)} data-overflow-item key={item.value}><TabContent iconOnly={iconOnly} item={item} /></span>)}
        <Button className="flex-none" data-overflow-more size="icon-sm" tabIndex={-1} variant="ghost"><EllipsisIcon /></Button>
      </div>
    </div>}
  </div>
}

export { OverflowTabs, OverflowTabsList }
