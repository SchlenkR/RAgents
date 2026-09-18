import { useSyncExternalStore } from "react";

interface ListState {
  entries?: string[];
}

interface ListContext {
  state: {
    read(): ListState;
    replace(value: ListState): void;
  };
}

type Append = (input: { text: string }, context: ListContext) => Promise<{ text: string; entries: string[] }>;

export function createHomepageMiniAppRuntime(append: Append) {
  let state: ListState = { entries: ["Beispiel: Erste Notiz"] };
  const listeners = new Set<() => void>();
  const read = () => state;
  const replace = (value: ListState) => {
    state = value;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };

  return {
    context: {
      capabilities: {
        async call(name: string, input: { text: string }) {
          if (name !== "append") throw new Error(`Diese lokale Demo kennt die Funktion ${name} nicht.`);
          return append(input, { state: { read, replace } });
        },
      },
    },
    useAppState: () => useSyncExternalStore(subscribe, read, read),
  };
}
