import type { StartWidgetContribution, WebPlugin } from "@ragents/web/PluginRegistry";
import { Empty, EmptyDescription } from "@ragents/web/ui";
import { rpc } from "@ragents/web/rpc";
import { globalAppsContracts, type GlobalAppsSnapshot } from "../contract";
import { GlobalAppWidget, UnavailableGlobalApp } from "./GlobalAppWidget";

export const globalAppWidgets = (snapshot: GlobalAppsSnapshot, retry: () => void): readonly StartWidgetContribution[] => {
  const apps = snapshot.apps.map((app): StartWidgetContribution => ({
    id: `ragents.global-apps:${app.name}`,
    title: app.views[0]?.title ?? app.name,
    span: app.views.length ? "wide" : "narrow",
    order: 200,
    readRight: "ragents.global-apps.read",
    content: <GlobalAppWidget app={app} runId={snapshot.runId!} revision={snapshot.revision} />,
  }));
  const errors = snapshot.errors.map((error): StartWidgetContribution => ({
    id: `ragents.global-apps:${error.id}`,
    title: error.name,
    span: "narrow",
    order: 200,
    readRight: "ragents.global-apps.read",
    content: <UnavailableGlobalApp name={error.name} problem={error.problem} revision={snapshot.revision} onRetry={retry} />,
  }));
  return [...apps, ...errors, ...snapshot.problem ? [{
    id: "ragents.global-apps:system:unavailable", title: "Global apps unavailable", span: "narrow" as const, order: 200,
    readRight: "ragents.global-apps.read", content: <UnavailableGlobalApp name="Global apps" problem={snapshot.problem!} revision={snapshot.revision} onRetry={retry} />,
  }] : []];
};

function EmptyGlobalApps() {
  return <Empty><EmptyDescription>Ask the global coordinator to build a global mini-app for your Start dashboard.</EmptyDescription></Empty>;
}

export const webPlugin: WebPlugin = {
  id: "ragents.global-apps",
  startWidgetsFor: ({ signal, update }) => {
    let unsubscribe: (() => void) | undefined;
    const subscribe = () => {
      unsubscribe?.();
      if (signal.aborted) return;
      unsubscribe = rpc.subscribe(globalAppsContracts.changed, {}, (snapshot) => {
        if (signal.aborted) return;
        const widgets = globalAppWidgets(snapshot, subscribe);
        update(widgets.length ? widgets : [{ id: "ragents.global-apps:system:empty", title: "Global mini-apps", span: "narrow", order: 200, readRight: "ragents.global-apps.read", content: <EmptyGlobalApps /> }]);
      }, (problem) => {
        if (!signal.aborted) update(globalAppWidgets({ runId: null, revision: 0, apps: [], errors: [], problem }, subscribe));
      });
    };
    signal.addEventListener("abort", () => unsubscribe?.(), { once: true });
    subscribe();
    return [];
  },
};
