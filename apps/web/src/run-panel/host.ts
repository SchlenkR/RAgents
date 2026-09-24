import { createContext, useContext, useSyncExternalStore } from "react";
import type { RunPanelHostKind } from "./run-panel-location";
import { isHostRunPanelMessage, type RunPanelHostMessage, type RunPanelTheme, type HostRunPanelMessage } from "./host-contract";

export interface RunPanelHost {
  readonly kind: RunPanelHostKind;
  /** Elemente des Runs, die der Host gerade in der Mitte zeigt; im Browser immer leer. */
  centerElements(runId: string): ReadonlySet<string>;
  subscribe(listener: () => void): () => void;
  openInCenter(runId: string, elementId: string, title: string): void;
  returnToRunPanel(runId: string, elementId: string): void;
  requestLogin(): void;
  /** Der Host hält den Sitzungstoken und beendet die Sitzung selbst. */
  requestLogout(): void;
  openExternal(url: string): void;
  /** Zeigt eine Webseite im Host, etwa als Reiter im Simple Browser von VS Code. */
  openPage(url: string, title: string): void;
  onCommand(listener: (message: HostRunPanelMessage) => void): () => void;
  /** Meldet dem Host, dass das Panel bereit ist, seinen Run gewechselt hat oder zurück auf die Start-Seite will. */
  notify(message: Extract<RunPanelHostMessage, { type: "ready" | "runChanged" | "showStart" }>): void;
}

const emptySet: ReadonlySet<string> = new Set();

const unsupported = (action: string) => (): never => {
  throw new Error(`${action} gibt es nur in VS Code.`);
};

export function createBrowserHost(browser: Window): RunPanelHost {
  return {
    kind: "browser",
    centerElements: () => emptySet,
    subscribe: () => () => undefined,
    openInCenter: unsupported("Eine Mini-App in die Mitte legen"),
    returnToRunPanel: unsupported("Eine Mini-App zurückholen"),
    requestLogin: unsupported("Die Anmeldung über den Host"),
    requestLogout: unsupported("Die Abmeldung über den Host"),
    openExternal: (url) => { browser.open(url, "_blank", "noopener"); },
    openPage: unsupported("Eine Webseite im Host zeigen"),
    onCommand: () => () => undefined,
    notify: () => undefined,
  };
}

/** Das Panel im iframe eines VS-Code-Webviews: Nachrichten laufen über das umgebende Webview zur Erweiterung. */
export function createVsCodeHost(browser: Window): RunPanelHost {
  const parent = browser.parent;
  if (parent === browser) throw new Error("Das Panel läuft mit host=vscode, ist aber in kein Webview eingebettet.");
  const placements = new Map<string, ReadonlySet<string>>();
  const placementListeners = new Set<() => void>();
  const commandListeners = new Set<(message: HostRunPanelMessage) => void>();
  const post = (message: RunPanelHostMessage) => parent.postMessage(message, "*");
  browser.addEventListener("message", (event) => {
    if (event.source !== parent || !isHostRunPanelMessage(event.data)) return;
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
    returnToRunPanel: (runId, elementId) => post({ type: "returnToRunPanel", runId, elementId }),
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

export const createRunPanelHost = (kind: RunPanelHostKind, browser: Window): RunPanelHost =>
  kind === "vscode" ? createVsCodeHost(browser) : createBrowserHost(browser);

const RunPanelHostContext = createContext<RunPanelHost | undefined>(undefined);

export const RunPanelHostProvider = RunPanelHostContext.Provider;

export function useRunPanelHost(): RunPanelHost {
  const host = useContext(RunPanelHostContext);
  if (!host) throw new Error("Das Panel läuft ohne Host-Provider.");
  return host;
}

export function useCenterElements(runId: string): ReadonlySet<string> {
  const host = useRunPanelHost();
  return useSyncExternalStore(host.subscribe, () => host.centerElements(runId), () => emptySet);
}

export type { RunPanelTheme };
