import { cn } from "@ragents/web/ui";

export type MaterialTone = "agent" | "primary" | "script" | "app";

/** Schichtwerk: matte Front mit geraden Kanten. */
const materialBaseClass = "relative isolate rounded-panel border-[1.5px] border-(--material-edge) bg-(--material-face) [--material-edge:#514657] dark:[--material-edge:#b7a8bd]";

const materialToneClass: Readonly<Record<MaterialTone, string>> = {
  agent: "[--material-face:var(--color-glass-agent)]",
  primary: "[--material-face:var(--color-glass-primary)]",
  script: "[--material-face:var(--color-glass-script)]",
  app: "[--material-face:var(--color-glass-app)]",
};

export const materialCardClass = (tone: MaterialTone, className?: string) =>
  cn(materialBaseClass, materialToneClass[tone], className);

/** Kopfzeile einer Materialkarte: dieselbe Front, eine Spur dunkler, oben gerundet. */
export const materialHeadClass = "relative flex items-center gap-2 rounded-t-[15.5px] bg-[color-mix(in_srgb,var(--material-face)_96%,black)] px-3 py-2";

export const materialTitleClass = "min-w-0 truncate p-0 text-[17px] font-[730] leading-[1.3] tracking-[-.5px]";

export const materialIconClass = "grid size-8 flex-none place-items-center rounded-[11px] border border-[#5146578a] bg-white/9 text-foreground shadow-glass-icon";
