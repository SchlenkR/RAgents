import * as React from "react"
import { cn } from "cn"
import { controlMetrics, controlRadius, type ControlSize } from "./control-size"

function Textarea({ className, size = "default", rows = 2, ...props }: React.ComponentProps<"textarea"> & { size?: ControlSize }) {
  return (
    <textarea
      data-slot="textarea"
      data-size={size}
      rows={rows}
      className={cn(
        "field-sizing-content min-h-(--control-height) w-full border border-border-strong bg-background px-2.5 py-[calc((var(--control-height)-var(--control-line-height)-2px)/2)] transition-[color,background-color,border-color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        controlMetrics[size],
        controlRadius[size],
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
