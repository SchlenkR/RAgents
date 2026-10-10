import { cn } from "cn";
import { ArrowLeftIcon, ArrowRightIcon, EllipsisIcon, EyeIcon, EyeOffIcon, LayoutDashboardIcon, RotateCcwIcon } from "lucide-react";
import { useId, useLayoutEffect, useState, type ReactNode } from "react";
import { useAccess } from "../AccessContext";
import { createLocalStorageSetting } from "../lib/local-storage-setting";
import { START_WIDGET_SPANS, type StartWidgetSpan } from "../PluginRegistry";
import { RenderBoundary } from "../RenderBoundary";
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "../ui";
import { OverflowTabs, OverflowTabsList } from "../ui/overflow-tabs";
import { SectionHeading } from "../ui/SectionLabel";
import { DASHBOARD_COLUMNS, dashboardLayout } from "./dashboard-layout";
import {
  arrangeWidgets, DEFAULT_DASHBOARD_PREFERENCES, isDefaultLayout, readDashboardLayout, startLayoutStorageKey, withHidden, withSpan, withSwap, writeDashboardLayout,
  type DashboardPreferences, type StoredDashboardLayout,
} from "./dashboard-preferences";

/** One area of Start: the built-in New and Continue or a plugin's start section. */
export interface StartWidget {
  /** Stable across sessions, because the viewer's layout refers to it. */
  readonly key: string;
  /** Without a title the content owns its heading, fills a row, and stays below the tabs. */
  readonly title?: string;
  readonly count?: number;
  readonly span: StartWidgetSpan;
  /** At the end of the title row, such as "All N runs". */
  readonly action?: ReactNode;
  readonly content: ReactNode;
}

type FramedWidget = StartWidget & { readonly title: string; readonly framed: boolean };

/** Where focus goes after the next commit: the menu button of a widget while it is visible, otherwise Customize. */
type FocusTarget = { readonly widget?: string };

const isFramed = (widget: StartWidget & { readonly framed: boolean }): widget is FramedWidget => widget.framed;

const SPAN_LABELS = { narrow: "Narrow", half: "Half", wide: "Wide", full: "Full" } as const satisfies Record<StartWidgetSpan, string>;

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

const layoutSetting = createLocalStorageSetting<StoredDashboardLayout>({
  changeEvent: "ragents-start-layout-change",
  matchesKey: (key) => key.startsWith("ragents.start.layout:"),
  parse: readDashboardLayout,
  serialize: (value) => {
    if (value.problem !== undefined) throw new Error("Start can only save a layout it could read.");
    return writeDashboardLayout(value.preferences);
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

/** The "..." menu in a widget's title row: its size, its place among the visible widgets, and hiding it. */
function WidgetMenu({ id, title, span, fallback, onSpan, onEarlier, onLater, onHide }: {
  id: string;
  title: string;
  span: StartWidgetSpan;
  fallback: StartWidgetSpan;
  onSpan: (span: StartWidgetSpan) => void;
  onEarlier?: () => void;
  onLater?: () => void;
  onHide: () => void;
}) {
  const choose = (value: unknown) => {
    const chosen = START_WIDGET_SPANS.find((option) => option === value);
    if (chosen === undefined) throw new Error(`Start widgets have no size ${String(value)}.`);
    onSpan(chosen);
  };
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button aria-label={`Arrange ${title}`} className="flex-none text-muted-foreground" data-widget-menu={id} size="icon-xs" title="Arrange ..." variant="ghost" />}>
      <EllipsisIcon />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-auto min-w-44 max-w-[min(20rem,var(--available-width))]">
      <DropdownMenuRadioGroup onValueChange={choose} value={span}>
        <DropdownMenuLabel>Size</DropdownMenuLabel>
        {START_WIDGET_SPANS.map((option) => <DropdownMenuRadioItem closeOnClick key={option} value={option}>
          {SPAN_LABELS[option]}
          {option === fallback && <span className="ml-auto pl-3 type-meta text-muted-foreground">Default</span>}
        </DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={onEarlier === undefined} onClick={onEarlier}><ArrowLeftIcon />Move earlier</DropdownMenuItem>
      <DropdownMenuItem disabled={onLater === undefined} onClick={onLater}><ArrowRightIcon />Move later</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onHide}><EyeOffIcon />Hide</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** Brings hidden widgets back and resets the layout: a text button below the grid, an icon button at the end of the tab strip. */
function CustomizeMenu({ hidden, customized, compact, onShow, onReset, triggerRef }: {
  hidden: readonly FramedWidget[];
  customized: boolean;
  compact: boolean;
  onShow: (key: string) => void;
  onReset: () => void;
  triggerRef: (element: HTMLButtonElement | null) => void;
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger ref={triggerRef} render={compact
      ? <Button aria-label="Customize" className="flex-none text-muted-foreground" size="icon-sm" title="Customize" variant="ghost" />
      : <Button className="text-muted-foreground" size="xs" variant="ghost" />}>
      <LayoutDashboardIcon data-icon="inline-start" />{!compact && "Customize"}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-auto min-w-48 max-w-[min(20rem,var(--available-width))]">
      <DropdownMenuGroup>
        <DropdownMenuLabel>Hidden widgets</DropdownMenuLabel>
        {hidden.length === 0
          ? <DropdownMenuItem disabled>None</DropdownMenuItem>
          : hidden.map((widget) => <DropdownMenuItem key={widget.key} onClick={() => onShow(widget.key)}><EyeIcon /><span className="min-w-0 truncate">Show {widget.title}</span></DropdownMenuItem>)}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!customized} onClick={onReset}><RotateCcwIcon />Reset layout</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** The host frame of a widget: its title row and its body; in tabs the tab shows the title, so the row keeps only the action and the menu. */
function WidgetFrame({ widget, title, tabs, menu }: { widget: StartWidget; title: string; tabs: boolean; menu: ReactNode }) {
  return <section aria-label={title} className="grid min-w-0 grid-cols-1 content-start gap-3">
    <SectionHeading className="min-h-control-xs items-center" count={widget.count} title={title} titleHidden={tabs}>
      <div className="flex flex-none items-center gap-1">{widget.action}{menu}</div>
    </SectionHeading>
    <div className="@container/widget min-w-0" data-start-widget-body={widget.key}>
      <RenderBoundary resetKeys={[]} title={`${title} could not be displayed`}>{widget.content}</RenderBoundary>
    </div>
  </section>;
}

/** Start's widgets in a twelve-column grid by their spans and the viewer's arrangement; below the narrow limit of its own width, tabs with one widget at a time. */
export function StartDashboard({ widgets }: { widgets: readonly StartWidget[] }) {
  const access = useAccess();
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [customize, setCustomize] = useState<HTMLButtonElement | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>();
  const width = useInlineSize(element);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const storageKey = startWidgetStorageKey(origin);
  const layoutKey = startLayoutStorageKey(origin, access.user?.id ?? null);
  const remembered = chosenWidget.useValue(storageKey);
  const stored = layoutSetting.useValue(layoutKey);
  const prefix = useId();
  const { shown, hidden } = arrangeWidgets(widgets.map((widget) => ({ ...widget, framed: widget.title !== undefined })), stored.preferences);
  const empty = useEmptyWidgets(element, shown.map((widget) => widget.key).join("\u0000"));
  const placed = shown.filter((widget) => !empty.has(widget.key));
  const framed = placed.filter(isFramed);
  const layout = dashboardLayout(placed.map(({ key, span, framed }) => ({ key, span: framed ? span : "full", framed })), width);
  const tabs = layout.mode === "tabs";
  const active = framed.find((widget) => widget.key === remembered)?.key ?? framed[0]?.key ?? "";
  const tabId = (key: string) => `${prefix}-tab-${encodeURIComponent(key)}`;
  const panelId = (key: string) => `${prefix}-panel-${encodeURIComponent(key)}`;
  const columns = (key: string) => layout.mode === "grid" ? layout.columns.get(key) ?? DASHBOARD_COLUMNS : DASHBOARD_COLUMNS;
  const defaults = new Map(widgets.map((widget) => [widget.key, widget.span]));
  const framedKeys = widgets.filter((widget) => widget.title !== undefined).map((widget) => widget.key);
  const save = (preferences: DashboardPreferences) => layoutSetting.save(layoutKey, { preferences });
  // Hiding removes the menu's own button and showing or resetting may switch between grid and tabs, so focus moves after the commit.
  const saveAndFocus = (preferences: DashboardPreferences, target: FocusTarget = {}) => {
    setFocusTarget(target);
    save(preferences);
  };
  useLayoutEffect(() => {
    if (focusTarget === undefined || !customize?.isConnected) return;
    const menu = focusTarget.widget === undefined ? null : element?.querySelector<HTMLElement>(`[data-widget-menu="${CSS.escape(focusTarget.widget)}"]`);
    (menu?.checkVisibility() ? menu : customize).focus();
    setFocusTarget(undefined);
  }, [focusTarget, customize, element]);
  const neighbor = (key: string, step: -1 | 1) => {
    const index = framed.findIndex((widget) => widget.key === key);
    return index < 0 ? undefined : framed[index + step];
  };
  const swap = (key: string, step: -1 | 1) => {
    const other = neighbor(key, step);
    return other === undefined ? undefined : () => save(withSwap(stored.preferences, framedKeys, key, other.key));
  };
  const hide = (key: string) => saveAndFocus(withHidden(stored.preferences, key, true), { widget: (neighbor(key, 1) ?? neighbor(key, -1))?.key });
  const customizeMenu = <CustomizeMenu compact={tabs} customized={!isDefaultLayout(stored.preferences)} hidden={hidden.filter(isFramed)}
    onReset={() => saveAndFocus(DEFAULT_DASHBOARD_PREFERENCES)} onShow={(key) => saveAndFocus(withHidden(stored.preferences, key, false))} triggerRef={setCustomize} />;
  return <OverflowTabs className="grid min-w-0 grid-cols-1 gap-3" onValueChange={(key) => chosenWidget.save(storageKey, key)} value={active}>
    {stored.problem !== undefined && <div className="flex flex-wrap items-center gap-2" role="alert">
      <p className="type-body text-destructive [overflow-wrap:anywhere]">{stored.problem}</p>
      <Button onClick={() => saveAndFocus(DEFAULT_DASHBOARD_PREFERENCES)} size="xs" variant="outline">Reset layout</Button>
    </div>}
    {tabs && <div className="flex min-w-0 items-center gap-1">
      <OverflowTabsList aria-label="Start widgets" className="min-w-0 flex-1" items={framed.map((widget) => ({
        value: widget.key, label: widget.title, count: widget.count, id: tabId(widget.key), controls: panelId(widget.key),
      }))} />
      {customizeMenu}
    </div>}
    <div className={cn("grid min-w-0 gap-x-6 gap-y-8", tabs ? "grid-cols-1 [&>:not([data-start-widget])]:order-1" : "grid-cols-12 [&>:not([data-start-widget])]:col-span-full")}
      data-dashboard={tabs ? "tabs" : "grid"} ref={setElement}>
      {shown.map((widget) => !isFramed(widget)
        ? <RenderBoundary key={widget.key} resetKeys={[]} title="A Start section could not be displayed">{widget.content}</RenderBoundary>
        : <div aria-labelledby={tabs ? tabId(widget.key) : undefined} className="min-w-0" data-start-widget={widget.key}
          hidden={empty.has(widget.key) || (tabs && widget.key !== active)} id={tabs ? panelId(widget.key) : undefined} key={widget.key}
          role={tabs ? "tabpanel" : undefined} style={tabs ? undefined : { gridColumn: `span ${columns(widget.key)} / span ${columns(widget.key)}` }}>
          <WidgetFrame menu={<WidgetMenu fallback={defaults.get(widget.key)!} id={widget.key} onEarlier={swap(widget.key, -1)} onHide={() => hide(widget.key)}
            onLater={swap(widget.key, 1)} onSpan={(span) => save(withSpan(stored.preferences, widget.key, span, defaults.get(widget.key)!))} span={widget.span} title={widget.title} />}
            tabs={tabs} title={widget.title} widget={widget} />
        </div>)}
    </div>
    {!tabs && <div className="flex justify-end">{customizeMenu}</div>}
  </OverflowTabs>;
}
