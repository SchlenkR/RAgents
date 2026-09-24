import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeftIcon } from "lucide-react";
import { ToolbarItem } from "./Toolbar";

export function SurfaceShortcuts({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [scroll, setScroll] = useState({ overflow: false, left: false, right: false });

  useEffect(() => {
    const container = containerRef.current!;
    const viewport = viewportRef.current!;
    const content = contentRef.current!;
    const measure = () => {
      const next = {
        overflow: content.scrollWidth > container.clientWidth + 1,
        left: viewport.scrollLeft > 1,
        right: viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1,
      };
      setScroll((current) => current.overflow === next.overflow && current.left === next.left && current.right === next.right ? current : next);
    };
    const wheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || viewport.scrollWidth <= viewport.clientWidth + 1) return;
      if (event.target instanceof Element && event.target.closest("[data-surface-scroll]")) return;
      event.preventDefault();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientWidth : 1;
      viewport.scrollLeft += delta * unit;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(viewport);
    observer.observe(content);
    viewport.addEventListener("scroll", measure);
    viewport.addEventListener("wheel", wheel, { passive: false });
    measure();
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", measure);
      viewport.removeEventListener("wheel", wheel);
    };
  }, []);

  const move = (direction: number) => {
    const viewport = viewportRef.current!;
    const item = Array.from(contentRef.current!.children).find((child) => child.getBoundingClientRect().width > 0);
    const step = item ? item.getBoundingClientRect().width : viewport.clientWidth / 3;
    viewport.scrollBy({ left: direction * step, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };

  return <div className="flex min-w-0 flex-1" ref={containerRef}>
    {scroll.overflow && <ToolbarItem as="button" aria-controls={id} aria-label="Apps und Actors nach links" className="w-8 justify-center px-0" disabled={!scroll.left} onClick={() => move(-1)} title="Nach links blättern" type="button"><ChevronLeftIcon size={18} /></ToolbarItem>}
    <div aria-label="Apps und Actors durchblättern" className="flex min-w-0 flex-1 items-stretch overflow-x-auto no-scrollbar focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:-outline-offset-3" id={id} ref={viewportRef} role="group" tabIndex={0}>
      <div className="flex w-max flex-none items-stretch" ref={contentRef}>{children}</div>
    </div>
    {scroll.overflow && <ToolbarItem as="button" aria-controls={id} aria-label="Apps und Actors nach rechts" className="w-8 justify-center border-r-0 border-l border-border px-0 [&>svg]:rotate-180" disabled={!scroll.right} onClick={() => move(1)} title="Nach rechts blättern" type="button"><ChevronLeftIcon size={18} /></ToolbarItem>}
  </div>;
}
