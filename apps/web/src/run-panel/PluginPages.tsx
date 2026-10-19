import { RenderBoundary } from "../RenderBoundary";
import type { PageContribution } from "../PluginRegistry";
import { Button } from "../ui";

/** One button per plugin page in the top bar, with its icon and title, which truncate when the bar is short; the open page's button is highlighted. */
export function PageButtons({ active, onOpen, pages }: {
  active: string | undefined;
  onOpen: (pageId: string) => void;
  pages: readonly PageContribution[];
}) {
  if (pages.length === 0) return null;
  return (
    <nav aria-label="Pages" className="flex max-w-3/4 min-w-0 items-center gap-1 overflow-x-clip">
      {pages.map(({ id, Icon, title }) => (
        <Button aria-current={id === active ? "page" : undefined} aria-label={title} className="min-w-9" key={id}
          onClick={() => { if (id !== active) onOpen(id); }} style={{ flexShrink: 1 }} variant="ghost">
          <Icon />
          <span className="truncate">{title}</span>
        </Button>
      ))}
    </nav>
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
