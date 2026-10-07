export interface HeaderWindowBounds {
  readonly width: number;
  readonly height: number;
  readonly start: number;
  readonly end: number;
  readonly gap: number;
}

export interface HeaderWindowSize {
  readonly width: number;
  readonly height: number;
}

export function headerWindowLayout(bounds: HeaderWindowBounds, sizes: readonly HeaderWindowSize[]) {
  const rowHeight = Math.max(0, ...sizes.map((size) => size.height));
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
    positions.push({ left, top: top === 0 ? Math.max(0, (bounds.height - size.height) / 2) : top });
    left += width + bounds.gap;
  }
  return { positions, height: Math.max(bounds.height, top + rowHeight) };
}
