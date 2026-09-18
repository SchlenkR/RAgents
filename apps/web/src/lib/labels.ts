export const THINKING_LABELS: Record<string, string> = {
  off: "aus",
  minimal: "minimal",
  low: "niedrig",
  medium: "mittel",
  high: "hoch",
  xhigh: "sehr hoch",
  max: "maximal",
};

export const thinkingLabel = (level: string) => THINKING_LABELS[level] ?? level;
