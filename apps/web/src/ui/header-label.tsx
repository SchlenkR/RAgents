import type { ReactNode } from "react"
import { cn } from "cn"

export type HeaderLabelCollapse = "pages" | "actions" | "status"

/** The text of an item in the run header: when the row gets tight, the header collapses it in its group's turn and leaves the item's icon, while the text stays the accessible name. */
function HeaderLabel({ children, className, collapse = "actions" }: { children: ReactNode; className?: string; collapse?: HeaderLabelCollapse }) {
  return <span className={cn("min-w-0 truncate data-collapsed:sr-only", className)} data-header-label={collapse}>{children}</span>
}

export { HeaderLabel }
