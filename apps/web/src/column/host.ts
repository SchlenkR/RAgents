import { createContext, useContext, useSyncExternalStore } from "react";
import type { ColumnHostKind } from "./column-location";
import { isHostColumnMessage, type ColumnHostMessage, type ColumnTheme, type HostColumnMessage } from "./host-contract";

export interface ColumnHost {
  readonly kind: ColumnHostKind;
  /** Elemente des Runs, die der Host gerade in der Mitte zeigt; im Browser immer leer. */
  centerElements(runId: string): ReadonlySet<string>;
  subscribe(listener: () => void): () => void;
  openInCenter(runId: string, elementId: string, title: string): void;
  returnToColumn(runId: string, elementId: string): void;
  requestLogin(): void;
  /** Der Host hält den Sitzungstoken und beendet die Sitzung selbst. */
  requestLogout(): void;
  openExternal(url: string): void;
  /** Zeigt eine Webseite im Host, etwa als Reiter im Simple Browser von VS Code. */
  openPage(url: string, title: string): void;
  onCommand(listener: (message: HostColumnMessage) => void): () => void;
  /** Meldet dem Host, dass die Spalte bereit ist oder ihren Run gewechselt hat. */
  notify(message: Extract<ColumnHostMessage, { type: "ready" | "runChanged" }>): void;
}

const emptySet: ReadonlySet<string> = new Set();

const unsupported = (action: string) => (): never => {
  throw new Error(`${action} gibt es nur in VS Code.`);
};

export function createBrowserHost(browser: Window): ColumnHost {
  return {
    kind: "browser",
    centerElements: () => emptySet,
    subscribe: () => () => undefined,
    openInCenter: unsupported("Eine Mini-App in die Mitte legen"),
    returnToColumn: unsupported("Eine Mini-App zurückholen"),
    requestLogin: unsupported("Die Anmeldung über den Host"),
    requestLogout: unsupported("Die Abmeldung über den Host"),
    openExternal: (url) => { browser.open(url, "_blank", "noopener"); },
    openPage: unsupported("Eine Webseite im Host zeigen"),
    onCommand: () => () => undefined,
    notify: () => undefined,
  };
}

/** Die Spalte im iframe eines VS-Code-Webviews: Nachrichten laufen über das umgebende Webview zur Erweiterung. */
export function createVsCodeHost(browser: Window): ColumnHost {
  const parent = browser.parent;
  if (parent === browser) throw new Error("Die Spalte läuft mit host=vscode, ist aber in kein Webview eingebettet.");
  const placements = new Map<string, ReadonlySet<string>>();
  const placementListeners = new Set<() => void>();
  const commandListeners = new Set<(message: HostColumnMessage) => void>();
  const post = (message: ColumnHostMessage) => parent.postMessage(message, "*");
  browser.addEventListener("message", (event) => {
    if (event.source !== parent || !isHostColumnMessage(event.data)) return;
    const message = event.data;
    if (message.type === "placements") {
      placements.set(message.runId, new Set(message.center));
      for (const listener of placementListeners) listener();
    }
    for (const listener of commandListeners) listener(message);
  });
  return {
    kind: "vscode",
    centerElements: (runId) => placements.get(runId) ?? emptySet,
    subscribe: (listener) => {
      placementListeners.add(listener);
      return () => { placementListeners.delete(listener); };
    },
    openInCenter: (runId, elementId, title) => post({ type: "openInCenter", runId, elementId, title }),
    returnToColumn: (runId, elementId) => post({ type: "returnToColumn", runId, elementId }),
    requestLogin: () => post({ type: "login" }),
    requestLogout: () => post({ type: "logout" }),
    openExternal: (url) => post({ type: "openExternal", url }),
    openPage: (url, title) => post({ type: "openPage", url, title }),
    onCommand: (listener) => {
      commandListeners.add(listener);
      return () => { commandListeners.delete(listener); };
    },
    notify: post,
  };
}

export const createColumnHost = (kind: ColumnHostKind, browser: Window): ColumnHost =>
  kind === "vscode" ? createVsCodeHost(browser) : createBrowserHost(browser);

const ColumnHostContext = createContext<ColumnHost | undefined>(undefined);

export const ColumnHostProvider = ColumnHostContext.Provider;

export function useColumnHost(): ColumnHost {
  const host = useContext(ColumnHostContext);
  if (!host) throw new Error("Die Spalte läuft ohne Host-Provider.");
  return host;
}

export function useCenterElements(runId: string): ReadonlySet<string> {
  const host = useColumnHost();
  return useSyncExternalStore(host.subscribe, () => host.centerElements(runId), () => emptySet);
}

export type { ColumnTheme };
