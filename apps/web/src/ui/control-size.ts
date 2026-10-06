export type ControlSize = "xs" | "sm" | "default" | "lg";

export const controlMetrics = {
  xs: "[--control-height:var(--spacing-control-xs)] [--control-line-height:1rem] text-xs leading-(--control-line-height)",
  sm: "[--control-height:var(--spacing-control-sm)] [--control-line-height:1rem] text-[0.8rem] leading-(--control-line-height)",
  default: "[--control-height:var(--spacing-control-default)] [--control-line-height:1.25rem] text-sm leading-(--control-line-height)",
  lg: "[--control-height:var(--spacing-control-lg)] [--control-line-height:1.25rem] text-sm leading-(--control-line-height)",
} satisfies Record<ControlSize, string>;

export const controlSizes = {
  xs: `${controlMetrics.xs} h-(--control-height)`,
  sm: `${controlMetrics.sm} h-(--control-height)`,
  default: `${controlMetrics.default} h-(--control-height)`,
  lg: `${controlMetrics.lg} h-(--control-height)`,
} satisfies Record<ControlSize, string>;
