import { createContext, useContext, type ReactNode } from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

type BadgeDisplay = "badge" | "dot"
type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral" | "active"

const dotTones: Record<BadgeTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  neutral: "bg-muted-foreground",
  active: "bg-active",
}

const BadgeDisplayContext = createContext<BadgeDisplay>("badge")

/** In "dot" mode badges keep their tone and their text for screen readers. */
function BadgeDisplayProvider({ children, value }: { children: ReactNode; value: BadgeDisplay }) {
  return <BadgeDisplayContext.Provider value={value}>{children}</BadgeDisplayContext.Provider>
}

const badgeVariants = cva(
  "group/badge inline-flex h-5.5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 text-xs leading-none font-medium whitespace-nowrap tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 has-[>svg:first-child]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary-hover",
        secondary:
          "border-border bg-secondary text-secondary-foreground [a]:hover:bg-hover",
        destructive:
          "border-destructive/30 bg-destructive-soft text-destructive [a]:hover:bg-destructive-hover",
        outline:
          "border-border-strong/70 text-foreground [a]:hover:bg-hover [a]:hover:text-hover-foreground",
        ghost:
          "hover:bg-hover hover:text-hover-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      tone: {
        success: "border-success/30 bg-success-soft text-success",
        warning: "border-warning/30 bg-warning-soft text-warning",
        danger: "border-destructive/30 bg-destructive-soft text-destructive",
        info: "border-info/30 bg-info-soft text-info",
        neutral: "border-border bg-secondary text-muted-foreground",
        active: "border-active/30 bg-active-soft text-active",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  tone,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  const dot = useContext(BadgeDisplayContext) === "dot"
  return useRender({
    defaultTagName: "span",
    props: dot
      ? mergeProps<"span">(
        { className: cn("block size-2 rounded-full", dotTones[tone ?? (variant === "destructive" ? "danger" : "info")]) },
        { ...props, children: <span className="sr-only">{props.children}</span> }
      )
      : mergeProps<"span">(
        {
          className: cn(badgeVariants({ variant: tone ? null : variant, tone }), tone && "[a]:hover:underline", className),
        },
        props
      ),
    render: dot ? undefined : render,
    state: {
      slot: "badge",
      variant,
      tone,
    },
  })
}

export { Badge, BadgeDisplayProvider, badgeVariants, type BadgeTone }
