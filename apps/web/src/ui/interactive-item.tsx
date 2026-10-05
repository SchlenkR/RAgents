import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "cn";
import { interactionStyle } from "./interaction";

export function InteractiveItem({ className, render, ...props }: useRender.ComponentProps<"button">) {
  return useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">({ type: "button", className: cn("border border-transparent select-none transition-colors aria-busy:bg-active-soft", interactionStyle, className) }, props),
    state: { slot: "interactive-item" },
  });
}
