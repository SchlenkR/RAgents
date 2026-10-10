import { useCallback, useMemo, useState } from "react";
import { useAccess } from "../AccessContext";
import type { StartWidgetSettingValues } from "../PluginRegistry";
import type { PanelAction, PanelState } from "./contract";
import { widgetWidth } from "./dashboard-layout";
import { HOST_START_SECTIONS, StartPageContext, type StartPageHost } from "./host-start-sections";
import type { PanelPageProps } from "./page-props";
import { StartDashboard, type StartWidget } from "./StartDashboard";
import { useStartWidgets } from "./start-widgets";

type NewRun = Extract<PanelAction, { action: "newRun" }>;

interface PendingStart {
  readonly action: NewRun;
  readonly state: PanelState;
}

/** Start's widgets, its own and the plugins', as start sections and dynamic widgets alike; without a registry only its own. */
export function StartPage({ state, send, registry, preferences }: PanelPageProps) {
  const access = useAccess();
  const [start, setStart] = useState<PendingStart>();
  const starting = start?.state === state ? start.action : undefined;
  const connection = state.connections[0]!;
  const startRun = useCallback((entryId?: string) => {
    const action: NewRun = entryId === undefined ? { action: "newRun", name: connection.name } : { action: "newRun", name: connection.name, entryId };
    send(action);
    setStart({ action, state });
  }, [connection.name, send, state]);
  const host = useMemo<StartPageHost>(() => ({ connection, sharing: state.sharing, send, starting, startRun }), [connection, send, startRun, starting, state.sharing]);
  const runs = useMemo(() => [...connection.runs].sort((left, right) => right.updatedAt - left.updatedAt), [connection.runs]);
  const openRun = useCallback((runId: string) => send({ action: "openRun", name: connection.name, runId }), [connection.name, send]);
  const visible = (right: string | undefined) => !right || access.can(right);
  const sections = (registry?.startSections ?? HOST_START_SECTIONS).filter((section) => visible(section.readRight));
  const dynamic = useStartWidgets(registry, { runs, onOpenRun: openRun }).filter((widget) => visible(widget.readRight));
  const widgets: readonly StartWidget[] = [
    ...sections.map(({ id, title, description, columns, minColumns, maxColumns, order, settings, Section }) => ({
      key: id, title, description, settings, ...widgetWidth({ columns, minColumns, maxColumns }), order,
      // The dashboard checked the values against the section's own settings.
      content: (values: StartWidgetSettingValues) => <Section onOpenRun={openRun} runs={runs} settings={values as never} />,
    })),
    ...dynamic.map(({ id, title, description, columns, minColumns, maxColumns, order, settings, content }) => ({
      key: id, title, description, settings, ...widgetWidth({ columns, minColumns, maxColumns }), order: order ?? 200,
      content: (values: StartWidgetSettingValues) => typeof content === "function" ? content(values as never) : content,
    })),
  ].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  return <div className="grid min-w-0 grid-cols-1 gap-8">
    {state.problem && <p className="type-body text-destructive [overflow-wrap:anywhere]" role="alert">{state.problem}</p>}
    {state.notice && <p className="type-body text-muted-foreground [overflow-wrap:anywhere]" role="status">{state.notice}</p>}
    <StartPageContext.Provider value={host}>
      <StartDashboard preferences={preferences} widgets={widgets} />
    </StartPageContext.Provider>
  </div>;
}
