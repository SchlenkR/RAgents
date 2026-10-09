/** Natural widths of a horizontal strip: each item, the space between items, the strip's own padding, and the overflow button with its gap. */
export interface OverflowMeasure {
  readonly items: readonly number[];
  readonly gap: number;
  readonly inset: number;
  readonly more: number;
  readonly available: number;
}

export interface OverflowSplit {
  readonly visible: readonly number[];
  readonly hidden: readonly number[];
}

const TOLERANCE = 0.01;

const widthOf = (measure: OverflowMeasure, indexes: readonly number[]): number => indexes.length === 0 ? 0
  : measure.inset + indexes.reduce((sum, index) => sum + (measure.items[index] ?? 0), 0) + measure.gap * (indexes.length - 1);

/** The items that stay in the strip, in their order: a leading run that fits beside the overflow button, always including the active item. */
export function splitOverflow(measure: OverflowMeasure, active: number): OverflowSplit {
  const all = measure.items.map((_, index) => index);
  if (widthOf(measure, all) <= measure.available + TOLERANCE) return { visible: all, hidden: [] };
  const budget = measure.available - measure.more + TOLERANCE;
  const leading = all.reduce<readonly number[]>((kept, index) =>
    kept.length === index && widthOf(measure, [...kept, index]) <= budget ? [...kept, index] : kept, []);
  const visible = active < 0 || active >= all.length || leading.includes(active) ? leading : withActive(measure, leading, active, budget);
  return { visible, hidden: all.filter((index) => !visible.includes(index)) };
}

/** Drops trailing items until the active one fits; the active item stays even when it alone is too wide. */
const withActive = (measure: OverflowMeasure, leading: readonly number[], active: number, budget: number): readonly number[] => {
  const count = leading.map((_, index) => leading.length - index).find((size) => widthOf(measure, [...leading.slice(0, size), active]) <= budget) ?? 0;
  return [...leading.slice(0, count), active].sort((left, right) => left - right);
};
