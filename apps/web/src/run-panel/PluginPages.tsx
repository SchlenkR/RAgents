import { useLayoutEffect, useRef, useState } from "react";
import { RenderBoundary } from "../RenderBoundary";
import type { PageContribution } from "../PluginRegistry";
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui";

// Below the header width at which the titles last wrapped or were cut, the buttons show only their icons.
const useIconsOnly = () => {
  const nav = useRef<HTMLElement>(null);
  const [limit, setLimit] = useState<number>();
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const element = nav.current;
    const header = element?.closest("header");
    if (!element || !header) return;
    const measure = () => {
      const current = header.clientWidth;
      setWidth(current);
      if (element.dataset.iconsOnly === "true") return;
      const buttons = [...element.children] as HTMLElement[];
      const wraps = buttons.some((button) => button.offsetTop !== buttons[0]!.offsetTop);
      const cut = [...element.querySelectorAll<HTMLElement>("[data-page-title]")].some((title) => title.scrollWidth > title.clientWidth);
      if (wraps || cut) setLimit(current + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return { nav, iconsOnly: limit !== undefined && width !== undefined && width < limit };
};

/** One button per plugin page in the top bar, with its icon and title; when the titles do not fit in one row, only the icons remain and the title shows on hover. The open page's button is highlighted. */
export function PageButtons({ active, onOpen, pages }: {
  active: string | undefined;
  onOpen: (pageId: string) => void;
  pages: readonly Pick<PageContribution, "id" | "Icon" | "title">[];
}) {
  const { nav, iconsOnly } = useIconsOnly();
  if (pages.length === 0) return null;
  return (
    <TooltipProvider>
      <nav aria-label="Pages" className="flex max-w-full flex-[0_1_auto] flex-wrap items-center gap-1" data-icons-only={iconsOnly} ref={nav} style={{ minWidth: `min(100%, calc(var(--spacing) * ${pages.length * 9 + pages.length - 1}))` }}>
        {pages.map(({ id, Icon, title }) => (
          <Tooltip disabled={!iconsOnly} disableHoverablePopup key={id}>
            <TooltipTrigger aria-current={id === active ? "page" : undefined} aria-label={title} className="min-w-9"
              onClick={() => { if (id !== active) onOpen(id); }} render={<Button variant="ghost" />} style={{ flexShrink: 1 }}>
              <Icon />
              {!iconsOnly && <span className="truncate" data-page-title="">{title}</span>}
            </TooltipTrigger>
            <TooltipContent className="pointer-events-none" side="bottom" sideOffset={6}>{title}</TooltipContent>
          </Tooltip>
        ))}
      </nav>
    </TooltipProvider>
  );
}

/** The open plugin page as plain content in the main area, which scrolls as a whole like Start. */
export function PluginPage({ onOpenRun, page }: { onOpenRun: (runId: string) => void; page: PageContribution }) {
  return (
    <main aria-label={page.title} className="relative h-full min-w-0 overflow-y-auto px-3 pb-12 [scrollbar-gutter:stable]" data-plugin-page={page.id} tabIndex={-1}>
      <div className="@container/panel mx-auto w-full min-w-0 pt-3">
        <RenderBoundary resetKeys={[page]} title={`The page ${page.title} could not be displayed`}>
          <page.Page onOpenRun={onOpenRun} />
        </RenderBoundary>
      </div>
    </main>
  );
}
