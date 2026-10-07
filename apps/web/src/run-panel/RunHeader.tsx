import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { headerWindowLayout, type HeaderWindowBounds } from "./header-window-layout";

const RunHeaderContext = createContext<{
  readonly controls: HTMLDivElement | null;
  readonly windows: HTMLDivElement | null;
  readonly bounds: HeaderWindowBounds;
  readonly onWindowsHeight: (height: number) => void;
} | null>(null);

export const useRunHeader = () => useContext(RunHeaderContext);

export function RunHeader({ leading, trailing, children }: { leading: ReactNode; trailing?: ReactNode; children: ReactNode }) {
  const [fixed, setFixed] = useState<HTMLDivElement | null>(null);
  const [start, setStart] = useState<HTMLDivElement | null>(null);
  const [end, setEnd] = useState<HTMLDivElement | null>(null);
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  const [windows, setWindows] = useState<HTMLDivElement | null>(null);
  const [bounds, setBounds] = useState<HeaderWindowBounds>({ width: 0, height: 0, start: 0, end: 0, gap: 0 });
  const [windowsHeight, setWindowsHeight] = useState(0);
  useLayoutEffect(() => {
    if (!fixed || !start || !end) return;
    const measure = () => {
      const row = fixed.getBoundingClientRect();
      const scale = row.width / fixed.offsetWidth || 1;
      const first = start.getBoundingClientRect();
      const last = end.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(fixed).columnGap) || 0;
      const sameRow = Math.abs(first.top + first.height / 2 - last.top - last.height / 2) < 1;
      const next = { width: fixed.clientWidth, height: fixed.offsetHeight, gap,
        start: sameRow ? (first.right - row.left) / scale + gap : fixed.clientWidth,
        end: sameRow ? (last.left - row.left) / scale - gap : 0 };
      setBounds((current) => Object.keys(next).every((key) => current[key as keyof HeaderWindowBounds] === next[key as keyof HeaderWindowBounds]) ? current : next);
    };
    const observer = new ResizeObserver(measure);
    for (const element of [fixed, start, end]) observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [fixed, start, end]);
  return <RunHeaderContext.Provider value={{ controls, windows, bounds, onWindowsHeight: setWindowsHeight }}>
    <header className="relative z-[80] min-h-header flex-none border-b border-border bg-shell px-2 py-1 shadow-bar">
      <div className="flex min-h-[30px] min-w-0 flex-wrap items-center gap-1" ref={setFixed}>
        <div className="flex min-w-0 max-w-full flex-[0_1_auto] flex-wrap items-center gap-1" data-header-fixed ref={setStart}>{leading}</div>
        <div className="pointer-events-none absolute inset-x-2 top-1 min-w-0" ref={setWindows} />
        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1" data-header-fixed ref={setEnd}>
          <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1 empty:hidden" ref={setControls} />
          {trailing}
        </div>
      </div>
      <div aria-hidden style={{ height: Math.max(0, windowsHeight - bounds.height) }} />
    </header>
    {children}
  </RunHeaderContext.Provider>;
}

export function useHeaderWindows(element: HTMLDivElement | null, entries: readonly string[]) {
  const header = useRunHeader();
  const [layout, setLayout] = useState<ReturnType<typeof headerWindowLayout>>();
  const bounds = header?.bounds;
  const reportHeight = header?.onWindowsHeight;
  useLayoutEffect(() => {
    if (!element || !bounds || !reportHeight || bounds.width === 0) return;
    const buttons = [...element.querySelectorAll<HTMLElement>("[data-header-window]")];
    const measure = () => {
      const scale = element.getBoundingClientRect().width / element.offsetWidth || 1;
      const next = headerWindowLayout(bounds, buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width / scale, height: rect.height / scale };
      }));
      setLayout((current) => current?.height === next.height && current.positions.length === next.positions.length
        && current.positions.every((position, index) => position.left === next.positions[index]!.left && position.top === next.positions[index]!.top) ? current : next);
      reportHeight(next.height);
    };
    const observer = new ResizeObserver(measure);
    for (const button of buttons) observer.observe(button);
    measure();
    return () => observer.disconnect();
  }, [element, bounds, reportHeight, entries]);
  useLayoutEffect(() => () => reportHeight?.(0), [reportHeight]);
  return header ? layout : undefined;
}
