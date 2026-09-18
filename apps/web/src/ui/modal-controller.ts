import { createContext, useContext, type ReactNode, type RefObject } from "react";

export type ModalNextBehavior = "push" | "replace";

export interface ModalPage {
  title: string;
  subtitle?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  render: (controller: ModalController) => ReactNode;
}

export interface ModalController {
  readonly canGoBack: boolean;
  open: (page: ModalPage) => void;
  back: () => void;
  close: () => void;
}

export interface ModalHistoryEntry {
  key: number;
  page: ModalPage | null;
}

export function createModalController({ nextBehavior, onClose, onNavigate }: {
  nextBehavior: () => ModalNextBehavior;
  onClose: () => void;
  onNavigate?: (from: number) => void;
}) {
  let history: readonly ModalHistoryEntry[] = [{ key: 0, page: null }];
  let nextKey = 1;
  const listeners = new Set<() => void>();
  const update = (next: readonly ModalHistoryEntry[]) => {
    onNavigate?.(history[history.length - 1].key);
    history = next;
    for (const listener of listeners) listener();
  };
  return {
    get canGoBack() { return history.length > 1; },
    open(page: ModalPage) {
      if (!page.title.trim()) throw new Error("Ein Dialogschritt benötigt einen Titel.");
      const previous = nextBehavior() === "push" ? history : history.slice(0, -1);
      update([...previous, { key: nextKey++, page }]);
    },
    back() {
      if (history.length < 2) throw new Error("Es gibt keinen vorherigen Dialogschritt.");
      update(history.slice(0, -1));
    },
    close() { onClose(); },
    reset() {
      if (history.length !== 1 || history[0].page !== null) update([{ key: 0, page: null }]);
    },
    getSnapshot: () => history,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  } satisfies ModalController & {
    reset: () => void;
    getSnapshot: () => readonly ModalHistoryEntry[];
    subscribe: (listener: () => void) => () => void;
  };
}

export const ModalControllerContext = createContext<ModalController | null>(null);

export function useModalController(): ModalController {
  const controller = useContext(ModalControllerContext);
  if (!controller) throw new Error("Die Dialogsteuerung benötigt einen Modal-Host.");
  return controller;
}
