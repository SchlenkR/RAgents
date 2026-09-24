import { useSyncExternalStore } from "react";

const stages = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();
const empty: ReadonlySet<string> = new Set();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function publishSurfaceEntities(runId: string, entities: ReadonlySet<string> | undefined) {
  if (entities) stages.set(runId, entities);
  else stages.delete(runId);
  listeners.forEach((listener) => listener());
}

export function useSurfaceEntities(runId: string): ReadonlySet<string> {
  const read = () => stages.get(runId) ?? empty;
  return useSyncExternalStore(subscribe, read, read);
}
