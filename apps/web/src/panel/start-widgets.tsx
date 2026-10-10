import { useEffect, useState } from "react";
import { useAccess } from "../AccessContext";
import { START_WIDGET_SPANS, type PluginRegistry, type StartSectionContext, type StartWidgetContribution, type StartWidgetsContext } from "../PluginRegistry";
import { Button } from "../ui";

type StartWidgetFactory = PluginRegistry["startWidgetFactories"][number];

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** A plugin's widgets keep their IDs under its own prefix, so they never collide with another plugin's or a start section's. */
export const checkedStartWidgets = (pluginId: string, widgets: readonly StartWidgetContribution[]): readonly StartWidgetContribution[] => {
  const ids = new Set<string>();
  return widgets.map((widget) => {
    if (!widget.id?.trim() || ids.has(widget.id)) throw new Error("Dynamic Start widgets need unique stable identifiers.");
    ids.add(widget.id);
    if (!widget.id.startsWith(`${pluginId}:`) || widget.id.length === pluginId.length + 1) throw new Error(`Start widget ${widget.id} needs an ID that starts with ${pluginId}:.`);
    if (!widget.title?.trim() || widget.content === undefined) throw new Error(`Start widget ${widget.id} has no title or content.`);
    if (widget.description !== undefined && !widget.description.trim()) throw new Error(`Start widget ${widget.id} has an empty description.`);
    if (widget.span !== undefined && !START_WIDGET_SPANS.includes(widget.span)) throw new Error(`Start widget ${widget.id} has an invalid span.`);
    if (widget.sizes !== undefined && (widget.sizes.some((size) => !START_WIDGET_SPANS.includes(size)) || new Set(widget.sizes).size !== widget.sizes.length
      || !widget.sizes.includes(widget.span ?? "full"))) throw new Error(`Start widget ${widget.id} needs distinct valid sizes that include its span.`);
    if (widget.order !== undefined && !Number.isFinite(widget.order)) throw new Error(`Start widget ${widget.id} has an invalid order.`);
    return widget;
  });
};

export async function loadStartWidgets(factory: StartWidgetFactory, context: StartWidgetsContext): Promise<readonly StartWidgetContribution[]> {
  return checkedStartWidgets(factory.id, await factory.create(context));
}

interface LoadedWidgets {
  readonly registry: PluginRegistry | undefined;
  readonly owner: string | null;
  readonly factories: ReadonlyMap<string, readonly StartWidgetContribution[]>;
}

/** The widgets of every factory; a factory that runs again keeps showing its previous widgets until it delivers new ones, and one that fails shows its cause in a widget of its own. */
export function useStartWidgets(registry: PluginRegistry | undefined, { runs, onOpenRun }: StartSectionContext): readonly StartWidgetContribution[] {
  const owner = useAccess().user?.id ?? null;
  const [loaded, setLoaded] = useState<LoadedWidgets>({ registry, owner, factories: new Map() });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const publish = (id: string, widgets: readonly StartWidgetContribution[]) => {
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
        span: "narrow",
        content: <div className="grid gap-2"><p role="alert" className="text-sm text-destructive">{errorText(cause)}</p><Button onClick={() => setRetry((value) => value + 1)} size="sm" variant="outline">Retry</Button></div>,
      }]);
      const update = (widgets: readonly StartWidgetContribution[]) => {
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
