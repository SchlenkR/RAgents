import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Tooltip, TooltipContent } from "../ui";
import { headerCollapse, headerCollapseOrder, type HeaderCollapse, type HeaderCollapseGroup } from "./header-collapse";
import { headerWindowLayout, type HeaderWindowBounds } from "./header-window-layout";

// The run title keeps this much of its text, or all of a shorter one, before labels give way.
const TITLE_MIN_REM = 6;
const wraps = "group-data-wrap/run-header:flex-wrap";

/** A group of header items: one row of natural width, which may shrink and wrap only once the whole header wraps. */
export const headerGroupClass = `flex flex-none items-center gap-1 group-data-wrap/run-header:min-w-0 group-data-wrap/run-header:max-w-full group-data-wrap/run-header:shrink ${wraps}`;

const RunHeaderContext = createContext<{
  readonly controls: HTMLDivElement | null;
  readonly windows: HTMLDivElement | null;
  readonly bounds: HeaderWindowBounds;
  readonly onWindowsHeight: (height: number) => void;
  /** Window buttons came or went; the header measures again before they are placed. */
  readonly onWindowsChange: () => void;
} | null>(null);

export const useRunHeader = () => useContext(RunHeaderContext);

export function HeaderControls({ children }: { children: ReactNode }) {
  const header = useRunHeader();
  const [container] = useState(() => {
    if (typeof document === "undefined") return null;
    const element = document.createElement("div");
    element.className = "contents";
    return element;
  });
  const target = header?.controls;
  useLayoutEffect(() => {
    if (!container || !target) return;
    target.append(container);
    return () => container.remove();
  }, [container, target]);
  return container && createPortal(children, container);
}

interface HeaderHint {
  readonly anchor: HTMLElement;
  readonly text: string;
}

/** The item under the pointer or keyboard focus whose label the header collapsed, with that label as its hint; an open dropdown's trigger shows none. */
const collapsedItem = (row: HTMLElement, target: EventTarget): HeaderHint | undefined => {
  const item = target instanceof Element ? target.closest<HTMLElement>(":has(> [data-header-label][data-collapsed])") : null;
  const label = item?.querySelector<HTMLElement>(":scope > [data-header-label]");
  return item && label && row.contains(item) && !item.closest("[aria-expanded='true']") ? { anchor: item, text: label.textContent ?? "" } : undefined;
};

const labelsOf = (row: HTMLElement) => headerCollapseOrder([...row.querySelectorAll<HTMLElement>("[data-header-label]")],
  (label) => label.dataset.headerLabel as HeaderCollapseGroup);

/** One row whenever possible: when the items do not fit, labels give way one by one in a fixed order (`header-collapse.ts`), and only then does the row wrap. */
export function RunHeader({ leading, trailing, children }: { leading: ReactNode; trailing?: ReactNode; children: ReactNode }) {
  const [header, setHeader] = useState<HTMLElement | null>(null);
  const [fixed, setFixed] = useState<HTMLDivElement | null>(null);
  const [start, setStart] = useState<HTMLDivElement | null>(null);
  const [reserve, setReserve] = useState<HTMLDivElement | null>(null);
  const [end, setEnd] = useState<HTMLDivElement | null>(null);
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  const [windows, setWindows] = useState<HTMLDivElement | null>(null);
  const [bounds, setBounds] = useState<HeaderWindowBounds>({ width: 0, height: 0, start: 0, end: 0, gap: 0 });
  const [windowsHeight, setWindowsHeight] = useState(0);
  const [hint, setHint] = useState<HeaderHint>();
  const windowsChanged = useRef(() => {});
  const onWindowsChange = useCallback(() => windowsChanged.current(), []);
  useLayoutEffect(() => {
    if (!header || !fixed || !start || !reserve || !end || !windows) return;
    const buttons = () => [...windows.querySelectorAll<HTMLElement>("[data-header-window]")];
    const titles = () => [...start.querySelectorAll<HTMLElement>("[data-header-title]")];
    const overflows = (element: HTMLElement) => element.scrollWidth > element.clientWidth + 1;
    const shape = () => [header.hasAttribute("data-wrap"), reserve.style.width, ...labelsOf(fixed).map((label) => label.hasAttribute("data-collapsed")),
      ...[fixed, start, end].map((element) => {
        const box = element.getBoundingClientRect();
        return `${box.width}x${box.height}`;
      })].join("|");
    // Labels and the reserved width change only through attributes and a style the header sets itself, so every count is measured synchronously; transitions would report sizes from before it.
    const settle = () => {
      const before = shape();
      const labels = labelsOf(fixed);
      header.dataset.measuring = "";
      const scale = fixed.getBoundingClientRect().width / fixed.offsetWidth || 1;
      const gap = parseFloat(getComputedStyle(fixed).columnGap) || 0;
      const titleMinimum = TITLE_MIN_REM * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
      const windowsWidth = () => {
        const widths = buttons().map((button) => button.getBoundingClientRect().width / scale);
        return Math.ceil(widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1));
      };
      const apply = (next: HeaderCollapse) => {
        labels.forEach((label, index) => label.toggleAttribute("data-collapsed", index < next.count));
        header.toggleAttribute("data-wrap", next.wrap);
        reserve.hidden = !next.windows;
        reserve.style.width = next.windows ? `${windowsWidth()}px` : "0px";
      };
      apply(headerCollapse((count, inRow) => {
        apply({ count, windows: inRow, wrap: false });
        return !overflows(fixed) && !overflows(start) && !overflows(end)
          && titles().every((title) => title.clientWidth + 1 >= Math.min(title.scrollWidth, titleMinimum));
      }, labels.length, buttons().length > 0));
      const row = fixed.getBoundingClientRect();
      const first = start.getBoundingClientRect();
      const last = end.getBoundingClientRect();
      const sameRow = Math.abs(first.top + first.height / 2 - last.top - last.height / 2) < 1;
      // A wrapped header still offers the windows the free space before the trailing controls on their own row.
      const ownRow = !sameRow && last.top >= first.bottom - 1;
      const measured: HeaderWindowBounds = { width: fixed.clientWidth, height: fixed.offsetHeight, gap,
        start: sameRow ? (first.right - row.left) / scale + gap : ownRow ? 0 : fixed.clientWidth,
        end: sameRow || ownRow ? (last.left - row.left) / scale - gap : 0,
        top: ownRow ? (last.top - row.top) / scale : 0,
        line: ownRow ? last.height / scale : fixed.offsetHeight };
      const after = shape();
      delete header.dataset.measuring;
      setBounds((current) => (Object.keys(measured) as (keyof HeaderWindowBounds)[]).every((key) => current[key] === measured[key]) ? current : measured);
      if (after !== before) setHint(undefined);
      return after !== before;
    };
    let frame = 0;
    let observed = new WeakSet<Element>();
    const track = () => {
      frame = 0;
      for (const target of [fixed, start, end, ...titles(), ...buttons()]) {
        if (observed.has(target)) continue;
        observed.add(target);
        observer.observe(target);
      }
    };
    const later = () => { frame ||= requestAnimationFrame(track); };
    const observer = new ResizeObserver(() => {
      if (!settle()) return later();
      // Sizes the header itself just changed, also by ending transitions, would be reported again in this frame, which the browser flags as a loop.
      observer.disconnect();
      observed = new WeakSet();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(track);
    });
    windowsChanged.current = () => {
      settle();
      later();
    };
    track();
    settle();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      windowsChanged.current = () => {};
    };
  }, [header, fixed, start, reserve, end, windows]);
  // Native listeners, because the run's controls are portaled in from outside the header's React tree.
  useEffect(() => {
    if (!header || !fixed) return;
    const show = (target: EventTarget | null) => {
      const next = target ? collapsedItem(fixed, target) : undefined;
      setHint((current) => current?.anchor === next?.anchor && current?.text === next?.text ? current : next);
    };
    const listeners: readonly [string, (event: Event) => void][] = [
      ["pointerover", (event) => show((event as PointerEvent).pointerType === "mouse" ? event.target : null)],
      ["pointerleave", () => show(null)],
      ["pointerdown", () => show(null)],
      ["focusin", (event) => show(event.target instanceof Element && event.target.matches(":focus-visible") ? event.target : null)],
      ["focusout", () => show(null)],
      ["keydown", (event) => { if ((event as KeyboardEvent).key === "Escape") show(null); }],
    ];
    for (const [type, listener] of listeners) header.addEventListener(type, listener);
    return () => { for (const [type, listener] of listeners) header.removeEventListener(type, listener); };
  }, [header, fixed]);
  const context = useMemo(() => ({ controls, windows, bounds, onWindowsHeight: setWindowsHeight, onWindowsChange }), [controls, windows, bounds, onWindowsChange]);
  return <RunHeaderContext.Provider value={context}>
    <header className="group/run-header relative z-[80] min-h-header flex-none border-b border-border bg-shell px-2 py-1 shadow-bar data-measuring:**:transition-none" ref={setHeader}>
      <div className={`flex min-h-[30px] min-w-0 items-center gap-1 ${wraps}`} ref={setFixed}>
        <div className={`flex min-w-0 flex-[0_1_auto] items-center gap-1 ${wraps}`} data-header-fixed ref={setStart}>{leading}</div>
        <div aria-hidden className="flex-none" ref={setReserve} />
        <div className="pointer-events-none absolute inset-x-2 top-1 min-w-0" ref={setWindows} />
        <div className={`${headerGroupClass} ml-auto justify-end`} data-header-fixed ref={setEnd}>
          <div className={`${headerGroupClass} justify-end empty:hidden`} ref={setControls} />
          {trailing}
        </div>
      </div>
      <div aria-hidden style={{ height: Math.max(0, windowsHeight - bounds.height) }} />
      <Tooltip onOpenChange={(open) => { if (!open) setHint(undefined); }} open={hint !== undefined}>
        <TooltipContent anchor={hint?.anchor} className="pointer-events-none" side="bottom" sideOffset={6}>{hint?.text}</TooltipContent>
      </Tooltip>
    </header>
    {children}
  </RunHeaderContext.Provider>;
}

export function useHeaderWindows(element: HTMLDivElement | null, entries: readonly string[]) {
  const header = useRunHeader();
  const [layout, setLayout] = useState<ReturnType<typeof headerWindowLayout>>();
  const bounds = header?.bounds;
  const reportHeight = header?.onWindowsHeight;
  const windowsChanged = header?.onWindowsChange;
  useLayoutEffect(() => windowsChanged?.(), [windowsChanged, entries]);
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
