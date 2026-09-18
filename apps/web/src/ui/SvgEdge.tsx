import { useId } from "react";
import { cn } from "cn";

export interface SvgEdgeProps {
  /** Native SVG path; the caller owns endpoints, curves and layout. */
  d: string;
  /** Arrowheads follow the path direction. Default: end. */
  arrow?: "none" | "end" | "both";
  lineStyle?: "solid" | "dashed";
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  /** Moving dashes show work in progress; reduced-motion preferences stop movement. */
  active?: boolean;
}

const toneClasses: Record<NonNullable<SvgEdgeProps["tone"]>, string> = {
  neutral: "text-border-strong",
  accent: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

const strokeClasses = "fill-none stroke-current stroke-2 [stroke-linecap:round]";

/** A styled connection inside the caller's SVG; nodes, labels and accessible descriptions remain caller-owned. */
export function SvgEdge({ d, arrow = "end", lineStyle = "solid", tone = "neutral", active = false }: SvgEdgeProps) {
  const markerId = `svg-edge${useId()}`;
  return <g className={toneClasses[tone]} data-active={active} data-line-style={lineStyle} data-tone={tone}>
    {arrow !== "none" && <defs><marker id={markerId} viewBox="0 0 12 12" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" refX="9" refY="6" orient="auto-start-reverse">
      <path className={cn(strokeClasses, "[stroke-linejoin:round]")} d="M3,2 L9,6 L3,10" />
    </marker></defs>}
    <path
      className={cn(strokeClasses, lineStyle === "dashed" && "[stroke-dasharray:4_6]",
        active && "[stroke-dasharray:9_5] animate-edge-flow motion-reduce:animate-none")}
      d={d}
      markerEnd={arrow === "none" ? undefined : `url(#${markerId})`}
      markerStart={arrow === "both" ? `url(#${markerId})` : undefined} />
  </g>;
}
