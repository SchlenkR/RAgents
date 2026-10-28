export type ControlSize = "xs" | "sm" | "default" | "lg";

export const controlMetrics = {
  xs: "[--control-height:var(--spacing-control-xs)] text-base",
  sm: "[--control-height:var(--spacing-control-sm)] text-base",
  default: "[--control-height:var(--spacing-control-default)] text-base",
  lg: "[--control-height:var(--spacing-control-lg)] text-base",
} satisfies Record<ControlSize, string>;

export const controlRadius = {
  xs: "[--control-radius:min(var(--radius-md),10px)] rounded-(--control-radius)",
  sm: "[--control-radius:min(var(--radius-md),12px)] rounded-(--control-radius)",
  default: "[--control-radius:var(--radius-lg)] rounded-(--control-radius)",
  lg: "[--control-radius:var(--radius-lg)] rounded-(--control-radius)",
} satisfies Record<ControlSize, string>;

export const controlSizes = {
  xs: `${controlMetrics.xs} h-(--control-height)`,
  sm: `${controlMetrics.sm} h-(--control-height)`,
  default: `${controlMetrics.default} h-(--control-height)`,
  lg: `${controlMetrics.lg} h-(--control-height)`,
} satisfies Record<ControlSize, string>;
