import type { ControlSize } from "./control-size";

export const dropdownPanelStyle = "rounded-xl bg-popover text-popover-foreground shadow-pop ring-1 ring-border";
export const dropdownAnchorWidth = "min-w-[calc(var(--anchor-width)+1px)]";
export const dropdownItemStyle = "gap-2 rounded-md px-2 py-1.25 text-sm";
export const dropdownLabelStyle = "px-2 pt-1.5 pb-1 text-xs font-semibold text-muted-foreground";
export const dropdownSeparatorStyle = "-mx-1 my-1 h-px bg-border";
export const dropdownCheckStyle = "size-3.5 text-primary";
export const dropdownChevronStyle = {
  xs: "size-3 text-muted-foreground",
  sm: "size-3 text-muted-foreground",
  default: "size-3.5 text-muted-foreground",
  lg: "size-3.5 text-muted-foreground",
} satisfies Record<ControlSize, string>;
