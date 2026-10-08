import type { RunAppNavigation } from "../run-apps";
import { createContext, createElement, useContext, type PropsWithChildren } from "react";
import { OfferedMachinesProvider, type OfferedMachines } from "../offered-machines";
import type { RunPanelHostKind } from "./run-panel-location";
import { isHostRunPanelMessage, type RunPanelHostMessage, type RunPanelTheme, type HostRunPanelMessage, type RunService } from "./host-contract";

export interface RunPanelHost extends RunAppNavigation {
  readonly kind: RunPanelHostKind;
  /** VS Code is a workstation itself and also offers workstations for new runs, the browser only the server. */
  readonly machines: OfferedMachines;
  requestLogin(): void;
  /** The host holds the session token and ends the session itself. */
  requestLogout(): void;
  openExternal(url: string): void;
  /** Shows a web page in the host, for example as a tab in the VS Code Simple Browser. */
  openPage(url: string, title: string): void;
  /** Opens a service of a run in the browser; VS Code reaches it directly on its own machine, otherwise through the server. */
  openService(service: RunService): void;
  onCommand(listener: (message: HostRunPanelMessage) => void): () => void;
  /** Tells the host that the panel is ready, has switched its run, or wants to go back to the Start page. */
  notify(message: Extract<RunPanelHostMessage, { type: "ready" | "runChanged" | "pageChanged" | "showStart" | "newRun" | "appearanceChanged" }>): void;
}

const unsupported = (action: string) => (): never => {
  throw new Error(`${action} is only available in VS Code.`);
};

export function createBrowserHost(browser: Window): RunPanelHost {
  return {
    kind: "browser",
    machines: "server",
    openApp: unsupported("Opening a mini-app editor"),
    requestLogin: unsupported("Signing in through the host"),
    requestLogout: unsupported("Signing out through the host"),
    openExternal: (url) => { browser.open(url, "_blank", "noopener"); },
    openPage: unsupported("Showing a web page in the host"),
    openService: unsupported("Opening a service of a run through a tunnel"),
    onCommand: () => () => undefined,
    notify: () => undefined,
  };
}

/** The panel in the iframe of a VS Code webview: messages go through the surrounding webview to the extension. */
export function createVsCodeHost(browser: Window): RunPanelHost {
  const parent = browser.parent;
  if (parent === browser) throw new Error("The panel runs with host=vscode but is not embedded in a webview.");
  const commandListeners = new Set<(message: HostRunPanelMessage) => void>();
  const post = (message: RunPanelHostMessage) => parent.postMessage(message, "*");
  browser.addEventListener("message", (event) => {
    if (event.source !== parent || !isHostRunPanelMessage(event.data)) return;
    const message = event.data;
    for (const listener of commandListeners) listener(message);
  });
  return {
    kind: "vscode",
    machines: "all",
    openApp: (runId, elementId, title) => post({ type: "openInCenter", runId, elementId, title }),
    requestLogin: () => post({ type: "login" }),
    requestLogout: () => post({ type: "logout" }),
    openExternal: (url) => post({ type: "openExternal", url }),
    openPage: (url, title) => post({ type: "openPage", url, title }),
    openService: (service) => post({ type: "openService", ...service }),
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

export type { RunPanelTheme };
