export const THINKING_LABELS: Record<string, string> = {
  off: "off",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "very high",
  max: "max",
};

export const thinkingLabel = (level: string) => THINKING_LABELS[level] ?? level;
