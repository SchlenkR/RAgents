import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"
import { controlSizes, type ControlSize } from "./control-size"

function Input({ className, type, size = "default", ...props }: Omit<React.ComponentProps<"input">, "size"> & { size?: ControlSize | number }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-size={typeof size === "number" ? "default" : size}
      size={typeof size === "number" ? size : undefined}
      className={cn(
        "w-full min-w-0 rounded-lg border border-input bg-background px-2.5 py-0 shadow-xs transition-colors outline-none file:inline-flex file:h-full file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        controlSizes[typeof size === "number" ? "default" : size],
        className
      )}
      {...props}
    />
  )
}

export { Input }
