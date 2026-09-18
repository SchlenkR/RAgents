import { useCallback, useLayoutEffect, useRef, useState, type RefCallback } from "react";

export interface CanvasSize {
  width: number;
  height: number;
}

type MeasuredElement = HTMLElement | SVGGraphicsElement;

export function useCanvasMeasurements() {
  const [sizes, setSizes] = useState<ReadonlyMap<string, CanvasSize>>(new Map());
  const elements = useRef(new Map<string, MeasuredElement>());
  const callbacks = useRef(new Map<string, RefCallback<MeasuredElement>>());
  const observer = useRef<ResizeObserver | null>(null);
  const frame = useRef<number | null>(null);

  const measure = useCallback(() => {
    frame.current = null;
    const measured = new Map<string, CanvasSize>();
    for (const [key, element] of elements.current) {
      // Layout dimensions remain in world coordinates, independent of camera transforms.
      const size = element instanceof SVGGraphicsElement ? element.getBBox() : { width: element.offsetWidth, height: element.offsetHeight };
      const { width, height } = size;
      if (element.isConnected && width > 0 && height > 0) measured.set(key, { width, height });
    }
    const keys = new Set(elements.current.keys());
    for (const key of callbacks.current.keys()) if (!keys.has(key)) callbacks.current.delete(key);
    setSizes((previous) => {
      const next = new Map<string, CanvasSize>();
      for (const key of keys) {
        const size = measured.get(key) ?? previous.get(key);
        if (size) next.set(key, size);
      }
      const changed = next.size !== previous.size || [...next].some(([key, size]) => {
        const before = previous.get(key);
        return !before || before.width !== size.width || before.height !== size.height;
      });
      return changed ? next : previous;
    });
  }, []);

  const schedule = useCallback(() => {
    if (observer.current && frame.current === null) frame.current = requestAnimationFrame(measure);
  }, [measure]);

  const refFor = useCallback((key: string): RefCallback<MeasuredElement> => {
    let callback = callbacks.current.get(key);
    if (!callback) {
      callback = (element) => {
        const previous = elements.current.get(key);
        if (previous === element) return;
        if (previous) observer.current?.unobserve(previous);
        if (element) {
          elements.current.set(key, element);
          observer.current?.observe(element, { box: "border-box" });
        } else elements.current.delete(key);
        schedule();
      };
      callbacks.current.set(key, callback);
    }
    return callback;
  }, [schedule]);

  useLayoutEffect(() => {
    const active = new ResizeObserver(schedule);
    observer.current = active;
    for (const element of elements.current.values()) active.observe(element, { box: "border-box" });
    measure();
    return () => {
      active.disconnect();
      observer.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [measure, schedule]);

  return { sizes, refFor };
}
