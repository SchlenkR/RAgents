import { cn } from "cn";
import { useId, useLayoutEffect, useState, type ReactNode } from "react";
import { createLocalStorageSetting } from "../lib/local-storage-setting";
import type { StartWidgetSpan } from "../PluginRegistry";
import { RenderBoundary } from "../RenderBoundary";
import { OverflowTabs, OverflowTabsList } from "../ui/overflow-tabs";
import { SectionHeading } from "../ui/SectionLabel";
import { DASHBOARD_COLUMNS, dashboardLayout } from "./dashboard-layout";

/** One area of Start: the built-in New and Continue or a plugin's start section. */
export interface StartWidget {
  readonly key: string;
  /** Without a title the content owns its heading, fills a row, and stays below the tabs. */
  readonly title?: string;
  readonly count?: number;
  readonly span: StartWidgetSpan;
  /** At the end of the title row, such as "All N runs". */
  readonly action?: ReactNode;
  readonly content: ReactNode;
}

export const startWidgetStorageKey = (origin: string) => `ragents.start.widget:${encodeURIComponent(origin)}`;

const chosenWidget = createLocalStorageSetting<string | undefined>({
  changeEvent: "ragents-start-widget-change",
  matchesKey: (key) => key.startsWith("ragents.start.widget:"),
  parse: (raw) => raw ?? undefined,
  serialize: (value) => {
    if (value === undefined) throw new Error("Start can only remember a widget it shows.");
    return value;
  },
});

/** The width of the dashboard itself, so that a narrow VS Code panel counts as narrow on a wide screen. */
function useInlineSize(element: HTMLElement | null): number | undefined {
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [element]);
  return width;
}

/** Widgets whose content currently renders nothing; they take neither a cell nor a tab. */
function useEmptyWidgets(element: HTMLElement | null, keys: string): ReadonlySet<string> {
  const [empty, setEmpty] = useState<ReadonlySet<string>>(() => new Set());
  useLayoutEffect(() => {
    if (!element) return;
    const check = () => {
      const next = [...element.querySelectorAll<HTMLElement>("[data-start-widget-body]")]
        .filter((body) => body.childNodes.length === 0)
        .map((body) => body.dataset.startWidgetBody!);
      setEmpty((current) => current.size === next.length && next.every((key) => current.has(key)) ? current : new Set(next));
    };
    const observer = new MutationObserver(check);
    observer.observe(element, { childList: true, subtree: true });
    check();
    return () => observer.disconnect();
  }, [element, keys]);
  return empty;
}

/** The host frame of a widget: its title row and its body; in tabs the tab shows the title, so the row keeps only the action. */
function WidgetFrame({ widget, title, tabs }: { widget: StartWidget; title: string; tabs: boolean }) {
  return <section aria-label={title} className="grid min-w-0 grid-cols-1 content-start gap-3">
    {tabs && widget.action === undefined
      ? <h2 className="sr-only">{title}</h2>
      : <SectionHeading className="min-h-control-xs items-center" count={widget.count} title={title} titleHidden={tabs}>{widget.action}</SectionHeading>}
    <div className="@container/widget min-w-0" data-start-widget-body={widget.key}>
      <RenderBoundary resetKeys={[]} title={`${title} could not be displayed`}>{widget.content}</RenderBoundary>
    </div>
  </section>;
}

/** Start's widgets in a twelve-column grid by their spans; below the narrow limit of its own width, tabs with one widget at a time. */
export function StartDashboard({ widgets }: { widgets: readonly StartWidget[] }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const width = useInlineSize(element);
  const empty = useEmptyWidgets(element, widgets.map((widget) => widget.key).join("\u0000"));
  const storageKey = startWidgetStorageKey(typeof window === "undefined" ? "" : window.location.origin);
  const remembered = chosenWidget.useValue(storageKey);
  const prefix = useId();
  const shown = widgets.filter((widget) => !empty.has(widget.key));
  const framed = shown.filter((widget): widget is StartWidget & { readonly title: string } => widget.title !== undefined);
  const layout = dashboardLayout(shown.map((widget) => ({
    key: widget.key, span: widget.title === undefined ? "full" : widget.span, framed: widget.title !== undefined,
  })), width);
  const tabs = layout.mode === "tabs";
  const active = framed.find((widget) => widget.key === remembered)?.key ?? framed[0]?.key ?? "";
  const tabId = (key: string) => `${prefix}-tab-${encodeURIComponent(key)}`;
  const panelId = (key: string) => `${prefix}-panel-${encodeURIComponent(key)}`;
  const columns = (key: string) => layout.mode === "grid" ? layout.columns.get(key) ?? DASHBOARD_COLUMNS : DASHBOARD_COLUMNS;
  return <OverflowTabs className="grid min-w-0 grid-cols-1 gap-3" onValueChange={(key) => chosenWidget.save(storageKey, key)} value={active}>
    {tabs && <OverflowTabsList aria-label="Start widgets" items={framed.map((widget) => ({
      value: widget.key, label: widget.title, count: widget.count, id: tabId(widget.key), controls: panelId(widget.key),
    }))} />}
    <div className={cn("grid min-w-0 gap-x-6 gap-y-8", tabs ? "grid-cols-1 [&>:not([data-start-widget])]:order-1" : "grid-cols-12 [&>:not([data-start-widget])]:col-span-full")}
      data-dashboard={tabs ? "tabs" : "grid"} ref={setElement}>
      {widgets.map((widget) => widget.title === undefined
        ? <RenderBoundary key={widget.key} resetKeys={[]} title="A Start section could not be displayed">{widget.content}</RenderBoundary>
        : <div aria-labelledby={tabs ? tabId(widget.key) : undefined} className="min-w-0" data-start-widget={widget.key}
          hidden={empty.has(widget.key) || (tabs && widget.key !== active)} id={tabs ? panelId(widget.key) : undefined} key={widget.key}
          role={tabs ? "tabpanel" : undefined} style={tabs ? undefined : { gridColumn: `span ${columns(widget.key)} / span ${columns(widget.key)}` }}>
          <WidgetFrame tabs={tabs} title={widget.title} widget={widget} />
        </div>)}
    </div>
  </OverflowTabs>;
}
