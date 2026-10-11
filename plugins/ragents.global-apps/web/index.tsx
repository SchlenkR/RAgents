import type { StartWidgetContribution, WebPlugin } from "@ragents/web/PluginRegistry";
import { rpc } from "@ragents/web/rpc";
import { globalAppsContracts, type GlobalAppsSnapshot } from "../contract";
import { GlobalAppWidget, UnavailableGlobalApp } from "./GlobalAppWidget";

export const globalAppWidgets = (snapshot: GlobalAppsSnapshot, retry: () => void): readonly StartWidgetContribution[] => {
  const apps = snapshot.apps.map((app): StartWidgetContribution => ({
    id: `ragents.global-apps:${app.name}`,
    title: app.views[0]?.title ?? app.name,
    description: app.description.trim() ? app.description : undefined,
    columns: app.views.length ? 4 : 2,
    order: 200,
    readRight: "ragents.global-apps.read",
    content: <GlobalAppWidget app={app} runId={snapshot.runId!} revision={snapshot.revision} />,
  }));
  const errors = snapshot.errors.map((error): StartWidgetContribution => ({
    id: `ragents.global-apps:${error.id}`,
    title: error.name,
    description: "A global mini-app that needs repair.",
    columns: 2,
    order: 200,
    readRight: "ragents.global-apps.read",
    content: <UnavailableGlobalApp name={error.name} problem={error.problem} removable onRetry={retry} />,
  }));
  return [...apps, ...errors, ...snapshot.problem ? [{
    id: "ragents.global-apps:system:unavailable", title: "Global apps unavailable", description: "Why your global mini-apps cannot be shown.", columns: 2, order: 200,
    readRight: "ragents.global-apps.read", content: <UnavailableGlobalApp name="Global apps" problem={snapshot.problem!} removable={false} onRetry={retry} />,
  }] : []];
};

export const webPlugin: WebPlugin = {
  id: "ragents.global-apps",
  // The first snapshot settles the promise, so a factory that runs again keeps the previous widgets until then.
  startWidgetsFor: ({ signal, update }) => new Promise<readonly StartWidgetContribution[]>((resolve) => {
    const publish = (widgets: readonly StartWidgetContribution[]) => {
      if (signal.aborted) return;
      update(widgets);
      resolve(widgets);
    };
    let unsubscribe: (() => void) | undefined;
    const subscribe = () => {
      unsubscribe?.();
      if (signal.aborted) return;
      unsubscribe = rpc.subscribe(globalAppsContracts.changed, {}, (snapshot) => {
        const widgets = globalAppWidgets(snapshot, subscribe);
        publish(widgets);
      }, (problem) => publish(globalAppWidgets({ runId: null, revision: 0, apps: [], errors: [], problem }, subscribe)));
    };
    signal.addEventListener("abort", () => unsubscribe?.(), { once: true });
    subscribe();
  }),
};
