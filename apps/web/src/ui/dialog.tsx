import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"
import { XIcon } from "lucide-react"

import { Button } from "./button"

export type ModalScope = "page" | "run" | "workspace" | "canvas"
export type DialogSize = "small" | "medium" | "large" | "wide" | "full"

export const RunModalContext = React.createContext<HTMLElement | null>(null)
export const WorkspaceModalContext = React.createContext<HTMLElement | null>(null)
export const CanvasModalContext = React.createContext<HTMLElement | null>(null)

const inertCounts = new Map<HTMLElement, { count: number; previous: boolean }>()

export function useModalContainer(scope: ModalScope): HTMLElement | null {
  const run = React.useContext(RunModalContext)
  const workspace = React.useContext(WorkspaceModalContext)
  const canvas = React.useContext(CanvasModalContext)
  return scope === "canvas" ? canvas : scope === "workspace" ? workspace : scope === "run" ? run : null
}

/** Only the siblings inside the scoped container go inert; toolbars outside stay usable. */
function useInertSiblings(container: HTMLElement | null, popup: React.RefObject<HTMLElement | null>, active: boolean) {
  React.useLayoutEffect(() => {
    if (!container || !active) return
    const targets = [...container.children].filter((child): child is HTMLElement =>
      child instanceof HTMLElement && !child.contains(popup.current))
    for (const target of targets) {
      const state = inertCounts.get(target) ?? { count: 0, previous: target.inert }
      state.count += 1
      inertCounts.set(target, state)
      target.inert = true
    }
    return () => {
      for (const target of targets) {
        const state = inertCounts.get(target)
        if (!state || --state.count > 0) continue
        target.inert = state.previous
        inertCounts.delete(target)
      }
    }
  }, [active, container, popup])
}

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

const sizeClasses: Record<DialogSize, string> = {
  small: "w-[min(420px,calc(100%-2rem))] max-h-[min(86%,900px)]",
  medium: "w-[min(560px,calc(100%-2rem))] max-h-[min(86%,900px)]",
  large: "w-[min(860px,calc(100%-2rem))] max-h-[min(86%,900px)]",
  wide: "w-[min(1180px,calc(100%-2rem))] h-[min(86%,900px)]",
  full: "w-[calc(100%-3rem)] h-[calc(100%-3rem)] max-sm:h-full max-sm:w-full max-sm:rounded-none",
}

export interface DialogContentProps extends DialogPrimitive.Popup.Props {
  scope?: ModalScope
  size?: DialogSize
  showCloseButton?: boolean
  onBackdropClick?: () => void
  overlayClassName?: string
  keepMounted?: boolean
  /** With keepMounted the closed dialog stays in the DOM; this keeps the container's siblings usable meanwhile. */
  open?: boolean
}

function DialogContent({
  className,
  children,
  scope = "page",
  size = "medium",
  showCloseButton = true,
  onBackdropClick,
  overlayClassName,
  keepMounted,
  open = true,
  ref,
  ...props
}: DialogContentProps) {
  const container = useModalContainer(scope)
  const popup = React.useRef<HTMLElement | null>(null)
  const [mounted, setMounted] = React.useState(false)
  useInertSiblings(container, popup, mounted && open)
  const scoped = container !== null
  return (
    <DialogPortal container={container ?? undefined} keepMounted={keepMounted}>
      <DialogOverlay
        className={cn(scoped ? "absolute z-[60]" : "z-[100]", scope === "workspace" && "z-[75]", overlayClassName)}
        forceRender={!scoped} // Base UI omits nested backdrops; a page dialog above a scoped modal still needs its own
        onClick={scoped ? onBackdropClick : undefined}
      />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-scope={scope}
        className={cn(
          "top-1/2 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-hidden rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          scoped ? "absolute z-[61] max-h-[calc(100%-2rem)]" : "fixed z-[100]",
          scope === "workspace" && "z-[76]",
          sizeClasses[size],
          className
        )}
        ref={(element: HTMLDivElement | null) => {
          popup.current = element
          setMounted(element !== null)
          if (typeof ref === "function") ref(element)
          else if (ref) ref.current = element
        }}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Schließen</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1 pr-8", className)}
      {...props}
    />
  )
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("flex min-h-0 flex-1 flex-col overflow-auto", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Schließen
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
