import { createElement, useCallback, useEffect, useState, type ReactNode } from "react";
import type { AccessContext } from "../../../packages/ragents/src/access";
import type { SessionContext, SessionNavigation, SurfaceElementAddition, SurfaceElementContribution, SurfaceElementDefinition } from "./PluginRegistry";

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

/** An addition a surface contribution offers beside the run's apps, such as "Show app...". */
export interface RunAppAddition {
  readonly id: string;
  readonly label: string;
  readonly Dialog: SurfaceElementAddition["Dialog"];
}

export function runAppAdditions(contributions: readonly SurfaceElementContribution[], access: Pick<AccessContext, "can">): readonly RunAppAddition[] {
  return contributions.flatMap(({ id, add }) => add && (add.right === undefined || access.can(add.right))
    ? [{ id: `add:${id}`, label: add.label, Dialog: add.Dialog }] : []);
}

/** The open addition dialog; an element it added goes to `open` once the run lists it. */
export function useRunAppAddition(apps: readonly RunApp[], session: SessionContext, open: (app: RunApp) => void): { start: (addition: RunAppAddition) => void; dialog: ReactNode } {
  const [adding, setAdding] = useState<RunAppAddition>();
  const [added, setAdded] = useState<string>();
  const target = added === undefined ? undefined : selectedRunApp(apps, added);
  useEffect(() => {
    if (!target) return;
    setAdded(undefined);
    open(target);
  }, [open, target]);
  const close = useCallback((elementId?: string) => {
    setAdding(undefined);
    setAdded(elementId);
  }, []);
  return { start: setAdding, dialog: adding ? createElement(adding.Dialog, { session, onClose: close }) : null };
}
