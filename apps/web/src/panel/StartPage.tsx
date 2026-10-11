import { useCallback, useMemo, useState } from "react";
import { useAccess } from "../AccessContext";
import type { StartWidgetSettingValues } from "../PluginRegistry";
import type { PanelAction, PanelState } from "./contract";
import { widgetWidth } from "./dashboard-layout";
import { HOST_START_WIDGETS, StartPageContext, type StartPageHost } from "./host-start-widgets";
import type { PanelPageProps } from "./page-props";
import { StartDashboard, type DashboardWidget } from "./StartDashboard";
import { byWidgetOrder, useStartWidgets } from "./start-widgets";

type NewRun = Extract<PanelAction, { action: "newRun" }>;

interface PendingStart {
  readonly action: NewRun;
  readonly state: PanelState;
}

/** Start's widgets, its own and the plugins', listed and published alike; without a registry only its own. */
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
  const published = useStartWidgets(registry, { runs, onOpenRun: openRun });
  const widgets: readonly DashboardWidget[] = [...(registry?.startWidgets ?? HOST_START_WIDGETS), ...published]
    .filter((widget) => !widget.readRight || access.can(widget.readRight))
    .sort(byWidgetOrder)
    .map(({ id, title, description, columns, minColumns, maxColumns, settings, render }) => ({
      key: id, title, description, settings, ...widgetWidth({ columns, minColumns, maxColumns }),
      // The dashboard checked the values against the widget's own settings.
      content: (values: StartWidgetSettingValues) => render({ runs, onOpenRun: openRun, settings: values as never }),
    }));
  return <div className="grid min-w-0 grid-cols-1 gap-8">
    {state.problem && <p className="type-body text-destructive [overflow-wrap:anywhere]" role="alert">{state.problem}</p>}
    {state.notice && <p className="type-body text-muted-foreground [overflow-wrap:anywhere]" role="status">{state.notice}</p>}
    <StartPageContext.Provider value={host}>
      <StartDashboard preferences={preferences} widgets={widgets} />
    </StartPageContext.Provider>
  </div>;
}
