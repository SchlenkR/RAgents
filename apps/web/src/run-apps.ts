import { createElement } from "react";
import type { SessionContext, SessionNavigation, SurfaceElementContribution, SurfaceElementDefinition } from "./PluginRegistry";

export interface RunApp {
  readonly runId: string;
  readonly definition: SurfaceElementDefinition;
  readonly Element: SurfaceElementContribution["Element"];
}

export interface RunAppNavigation {
  openApp(runId: string, elementId: string, title: string): void;
}

export function runApps(session: SessionContext, contributions: readonly SurfaceElementContribution[]): readonly RunApp[] {
  const ids = new Set<string>();
  return contributions.flatMap(({ Element, select }) => select(session).flatMap((definition) => {
    if (ids.has(definition.id)) throw new Error(`Duplicate mini-app ID: ${definition.id}`);
    ids.add(definition.id);
    return definition.visible === false ? [] : [{ runId: session.session.id, definition, Element }];
  }));
}

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
