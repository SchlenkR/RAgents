import { useEffect, useState } from "react";
import { useAccess } from "../AccessContext";
import type { PluginRegistry, StartWidget, StartWidgetContext, StartWidgetFactoryContext } from "../PluginRegistry";
import { Button } from "../ui";
import { widthProblem } from "./dashboard-layout";
import { settingsProblem } from "./widget-settings";

type StartWidgetFactory = PluginRegistry["startWidgetFactories"][number];

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

export const byWidgetOrder = (left: StartWidget, right: StartWidget): number => left.order - right.order || left.id.localeCompare(right.id);

const widgetProblem = (widget: StartWidget): string | undefined => {
  const untitled = widget.title === undefined;
  if (!untitled && !widget.title.trim()) return "has an empty title";
  if (!Number.isFinite(widget.order)) return "has an invalid order";
  if (typeof widget.render !== "function") return "has no render function";
  if (untitled && (widget.columns !== undefined || widget.minColumns !== undefined || widget.maxColumns !== undefined)) return "declares a width without a title";
  if (untitled && widget.description !== undefined) return "declares a description without a title";
  if (untitled && widget.settings !== undefined) return "declares settings without a title";
  if (widget.description !== undefined && !widget.description.trim()) return "has an empty description";
  return widthProblem(widget) ?? (widget.settings === undefined ? undefined : settingsProblem(widget.settings));
};

/** The rules every Start widget follows, whether a plugin lists it or its factory publishes it. */
export const checkedStartWidget = (widget: StartWidget): StartWidget => {
  const problem = widgetProblem(widget);
  if (problem !== undefined) throw new Error(`Start widget ${widget.id} ${problem}.`);
  return widget;
};

/** A factory's widgets keep their IDs under its plugin's prefix, so they never collide with another plugin's or a listed widget. */
export const checkedStartWidgets = (pluginId: string, widgets: readonly StartWidget[]): readonly StartWidget[] => {
  const ids = new Set<string>();
  return widgets.map((widget) => {
    if (!widget.id?.trim() || ids.has(widget.id)) throw new Error("Published Start widgets need unique stable identifiers.");
    ids.add(widget.id);
    if (!widget.id.startsWith(`${pluginId}:`) || widget.id.length === pluginId.length + 1) throw new Error(`Start widget ${widget.id} needs an ID that starts with ${pluginId}:.`);
    return checkedStartWidget(widget);
  });
};

export async function loadStartWidgets(factory: StartWidgetFactory, context: StartWidgetFactoryContext): Promise<readonly StartWidget[]> {
  return checkedStartWidgets(factory.id, await factory.create(context));
}

interface LoadedWidgets {
  readonly registry: PluginRegistry | undefined;
  readonly owner: string | null;
  readonly factories: ReadonlyMap<string, readonly StartWidget[]>;
}

/** The widgets of every factory; a factory that runs again keeps showing its previous widgets until it delivers new ones, and one that fails shows its cause in a widget of its own. */
export function useStartWidgets(registry: PluginRegistry | undefined, { runs, onOpenRun }: StartWidgetContext): readonly StartWidget[] {
  const owner = useAccess().user?.id ?? null;
  const [loaded, setLoaded] = useState<LoadedWidgets>({ registry, owner, factories: new Map() });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const publish = (id: string, widgets: readonly StartWidget[]) => {
      if (controller.signal.aborted) return;
      setLoaded((current) => ({ registry, owner, factories: new Map([
        ...current.registry === registry && current.owner === owner ? current.factories : [],
        [id, widgets],
      ]) }));
    };
    for (const factory of registry?.startWidgetFactories ?? []) {
      let published = false;
      const failed = (cause: unknown) => publish(factory.id, [{
        id: `${factory.id}:unavailable`,
        title: "Widgets unavailable",
        columns: 2,
        order: 200,
        render: () => <div className="grid gap-2"><p role="alert" className="text-sm text-destructive">{errorText(cause)}</p><Button onClick={() => setRetry((value) => value + 1)} size="sm" variant="outline">Retry</Button></div>,
      }]);
      const update = (widgets: readonly StartWidget[]) => {
        published = true;
        try { publish(factory.id, checkedStartWidgets(factory.id, widgets)); } catch (cause) { failed(cause); }
      };
      void loadStartWidgets(factory, { runs, onOpenRun, signal: controller.signal, update }).then((widgets) => {
        if (!published) update(widgets);
      }).catch(failed);
    }
    return () => controller.abort();
  }, [registry, owner, runs, onOpenRun, retry]);
  return loaded.registry === registry && loaded.owner === owner ? [...loaded.factories.values()].flat() : [];
}
