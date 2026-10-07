import * as React from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { cn } from "cn"
import { controlRadius, controlSizes, type ControlSize } from "./control-size"
import { focusRing, outlinedControl, selectionTint } from "./interaction"

const ToggleGroupContext = React.createContext<ControlSize>("default")

export const segmentedOptionLimit = 5

function ToggleGroup<Value extends string>({
  className,
  size = "default",
  orientation = "horizontal",
  children,
  ...props
}: ToggleGroupPrimitive.Props<Value> & { size?: ControlSize }) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-size={size}
      orientation={orientation}
      className={cn(
        controlSizes[size],
        controlRadius[size],
        outlinedControl,
        "group/toggle-group isolate flex w-fit flex-row items-stretch gap-0 overflow-hidden border data-vertical:h-auto data-vertical:flex-col",
        className
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={size}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

function ToggleGroupItem({ className, ...props }: TogglePrimitive.Props) {
  const size = React.useContext(ToggleGroupContext)
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-size={size}
      className={cn(
        focusRing,
        selectionTint,
        "inline-flex h-full min-w-0 flex-auto items-center justify-center gap-1 rounded-none first:rounded-s-[inherit] last:rounded-e-[inherit] group-data-vertical/toggle-group:first:rounded-s-none group-data-vertical/toggle-group:first:rounded-t-[inherit] group-data-vertical/toggle-group:last:rounded-e-none group-data-vertical/toggle-group:last:rounded-b-[inherit] border-0 bg-transparent px-2.5 font-medium whitespace-nowrap text-muted-foreground transition-colors selected:outline-solid selected:outline-1 selected:-outline-offset-1 selected:outline-selected-border not-first:border-l not-first:border-border hover:bg-hover hover:text-hover-foreground focus-visible:z-10 focus-visible:ring-inset focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 group-data-vertical/toggle-group:h-(--control-height) group-data-vertical/toggle-group:flex-none group-data-vertical/toggle-group:not-first:border-t group-data-vertical/toggle-group:not-first:border-l-0 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        size === "xs" && "px-2 [&_svg]:size-3",
        size === "sm" && "[&_svg]:size-3.5",
        className
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
