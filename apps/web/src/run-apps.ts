import { createElement } from "react";
import type { SessionContext, SessionNavigation, SurfaceElementContribution, SurfaceElementDefinition } from "./PluginRegistry";

export interface RunApp {
  readonly runId: string;
  readonly definition: SurfaceElementDefinition;
  readonly Element: SurfaceElementContribution["Element"];
  /** The app's place in the browser dock: its layoutKey or ID, numbered when an earlier visible app of the run holds it. */
  readonly layoutKey: string;
}

export interface RunAppNavigation {
  openApp(runId: string, elementId: string, title: string): void;
}

export function runApps(session: SessionContext, contributions: readonly SurfaceElementContribution[]): readonly RunApp[] {
  const ids = new Set<string>();
  const visible = contributions.flatMap(({ Element, select }) => select(session).flatMap((definition) => {
    if (ids.has(definition.id)) throw new Error(`Duplicate mini-app ID: ${definition.id}`);
    ids.add(definition.id);
    return definition.visible === false ? [] : [{ definition, Element }];
  }));
  return visible.reduce<readonly RunApp[]>((apps, { definition, Element }) =>
    [...apps, { runId: session.session.id, definition, Element, layoutKey: freeLayoutKey(apps, definition.layoutKey ?? definition.id) }], []);
}

const freeLayoutKey = (apps: readonly RunApp[], key: string, count = 1): string => {
  const candidate = count === 1 ? key : `${key}~${count}`;
  return apps.some((app) => app.layoutKey === candidate) ? freeLayoutKey(apps, key, count + 1) : candidate;
};

export function selectedRunApp(apps: readonly RunApp[], elementId: string | null | undefined): RunApp | undefined {
  return apps.find(({ definition }) => definition.id === elementId);
}

export function RunAppView({ app, navigation, session }: {
  app: RunApp;
  navigation: SessionNavigation;
  session: SessionContext;
}) {
  if (app.runId !== session.session.id) throw new Error("The mini-app belongs to another run.");
  return createElement(app.Element, { definition: app.definition, navigation, session });
}
