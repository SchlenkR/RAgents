/** The groups of labels in the order they give way when the header does not fit in one row: page titles, the other item labels, then the run's status texts. */
export const headerCollapseGroups = ["pages", "actions", "status"] as const;

export type HeaderCollapseGroup = typeof headerCollapseGroups[number];

export interface HeaderCollapse {
  /** How many labels of the collapse order give way. */
  readonly count: number;
  /** The run's windows share the first row instead of continuing below it. */
  readonly windows: boolean;
  /** Even the fully collapsed controls need more than one row. */
  readonly wrap: boolean;
}

/** The order in which labels give way: group by group, and within a group from left to right. */
export const headerCollapseOrder = <T>(labels: readonly T[], group: (label: T) => HeaderCollapseGroup): readonly T[] =>
  headerCollapseGroups.flatMap((current) => labels.filter((label) => group(label) === current));

// The smallest count from low to high that fits, given that high fits and that more collapsed labels never need more room.
const fewest = (low: number, high: number, fits: (count: number) => boolean): number => {
  if (low >= high) return high;
  const middle = Math.floor((low + high) / 2);
  return fits(middle) ? fewest(low, middle, fits) : fewest(middle + 1, high, fits);
};

/** The fewest collapsed labels with which controls and windows fit in one row; when the windows never fit, the fewest for the controls alone, with the windows below; wrapping comes last, with every label collapsed. */
export function headerCollapse(fits: (count: number, windows: boolean) => boolean, labels: number, hasWindows: boolean): HeaderCollapse {
  const fitting = (hasWindows ? [true, false] : [false]).find((windows) => fits(labels, windows));
  return fitting === undefined
    ? { count: labels, windows: false, wrap: true }
    : { count: fewest(0, labels, (count) => fits(count, fitting)), windows: fitting, wrap: false };
}
