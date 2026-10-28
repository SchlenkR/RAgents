export interface HeaderWindowBounds {
  readonly width: number;
  /** The height of the fixed controls; continuation rows start below it. */
  readonly height: number;
  /** The free stretch of a fixed row that the windows fill first. */
  readonly start: number;
  readonly end: number;
  /** That row's top and height; without them it is the whole height of the fixed controls. */
  readonly top?: number;
  readonly line?: number;
  readonly gap: number;
}

export interface HeaderWindowSize {
  readonly width: number;
  readonly height: number;
}

export function headerWindowLayout(bounds: HeaderWindowBounds, sizes: readonly HeaderWindowSize[]) {
  const rowHeight = Math.max(0, ...sizes.map((size) => size.height));
  const lineTop = bounds.top ?? 0;
  const lineHeight = bounds.line ?? bounds.height;
  const positions: { readonly left: number; readonly top: number }[] = [];
  let left = bounds.start;
  let top = 0;
  let end = bounds.end;
  for (const size of sizes) {
    const width = Math.min(size.width, bounds.width);
    if (left + width > end + 0.5) {
      left = 0;
      top = top === 0 ? bounds.height + bounds.gap : top + rowHeight + bounds.gap;
      end = bounds.width;
    }
    positions.push({ left, top: top === 0 ? lineTop + Math.max(0, (lineHeight - size.height) / 2) : top });
    left += width + bounds.gap;
  }
  return { positions, height: Math.max(bounds.height, top + rowHeight) };
}
