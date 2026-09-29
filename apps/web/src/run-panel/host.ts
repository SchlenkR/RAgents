import { createContext, createElement, useContext, useSyncExternalStore, type PropsWithChildren } from "react";
import { OfferedMachinesProvider, type OfferedMachines } from "../offered-machines";
import type { RunPanelHostKind } from "./run-panel-location";
import { isHostRunPanelMessage, type RunPanelHostMessage, type RunPanelTheme, type HostRunPanelMessage } from "./host-contract";

export interface RunPanelHost {
  readonly kind: RunPanelHostKind;
  /** VS Code is a workstation itself and also offers workstations for new runs, the browser only the server. */
  readonly machines: OfferedMachines;
  /** Elements of the run that the host currently shows in the center; always empty in the browser. */
  centerElements(runId: string): ReadonlySet<string>;
  subscribe(listener: () => void): () => void;
  openInCenter(runId: string, elementId: string, title: string): void;
  returnToRunPanel(runId: string, elementId: string): void;
  requestLogin(): void;
  /** The host holds the session token and ends the session itself. */
  requestLogout(): void;
  openExternal(url: string): void;
  /** Shows a web page in the host, for example as a tab in the VS Code Simple Browser. */
  openPage(url: string, title: string): void;
  onCommand(listener: (message: HostRunPanelMessage) => void): () => void;
  /** Tells the host that the panel is ready, has switched its run, or wants to go back to the Start page. */
  notify(message: Extract<RunPanelHostMessage, { type: "ready" | "runChanged" | "showStart" }>): void;
}

const emptySet: ReadonlySet<string> = new Set();

const unsupported = (action: string) => (): never => {
  throw new Error(`${action} is only available in VS Code.`);
};

export function createBrowserHost(browser: Window): RunPanelHost {
  return {
    kind: "browser",
    machines: "server",
    centerElements: () => emptySet,
    subscribe: () => () => undefined,
    openInCenter: unsupported("Placing a mini-app in the center"),
    returnToRunPanel: unsupported("Bringing a mini-app back"),
    requestLogin: unsupported("Signing in through the host"),
    requestLogout: unsupported("Signing out through the host"),
    openExternal: (url) => { browser.open(url, "_blank", "noopener"); },
    openPage: unsupported("Showing a web page in the host"),
    onCommand: () => () => undefined,
    notify: () => undefined,
  };
}

/** The panel in the iframe of a VS Code webview: messages go through the surrounding webview to the extension. */
export function createVsCodeHost(browser: Window): RunPanelHost {
  const parent = browser.parent;
  if (parent === browser) throw new Error("The panel runs with host=vscode but is not embedded in a webview.");
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
    machines: "all",
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

/** Provides the host and with it which machines the start options offer. */
export function RunPanelHostProvider({ value, children }: PropsWithChildren<{ value: RunPanelHost }>) {
  return createElement(RunPanelHostContext.Provider, { value }, createElement(OfferedMachinesProvider, { value: value.machines }, children));
}

export function useRunPanelHost(): RunPanelHost {
  const host = useContext(RunPanelHostContext);
  if (!host) throw new Error("The panel runs without a host provider.");
  return host;
}

export function useCenterElements(runId: string): ReadonlySet<string> {
  const host = useRunPanelHost();
  return useSyncExternalStore(host.subscribe, () => host.centerElements(runId), () => emptySet);
}

export type { RunPanelTheme };
