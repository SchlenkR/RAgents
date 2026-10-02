import { createContext, useContext, type ReactNode } from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

type BadgeDisplay = "badge" | "dot"

const BadgeDisplayContext = createContext<BadgeDisplay>("badge")

/** In "dot" mode every Badge below shows a small info dot and keeps its text for screen readers only. */
function BadgeDisplayProvider({ children, value }: { children: ReactNode; value: BadgeDisplay }) {
  return <BadgeDisplayContext.Provider value={value}>{children}</BadgeDisplayContext.Provider>
}

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-accent [a]:hover:text-foreground",
        ghost:
          "hover:bg-accent hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
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
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  const dot = useContext(BadgeDisplayContext) === "dot"
  return useRender({
    defaultTagName: "span",
    props: dot
      ? mergeProps<"span">(
        { className: "block size-2 rounded-full bg-info" },
        { ...props, children: <span className="sr-only">{props.children}</span> }
      )
      : mergeProps<"span">(
        {
          className: cn(badgeVariants({ variant }), className),
        },
        props
      ),
    render: dot ? undefined : render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, BadgeDisplayProvider, badgeVariants }
