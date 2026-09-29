import { createContext, useContext } from "react";

/** Where a UI offers new runs: the browser only on the server, VS Code, being a workstation itself, also on workstations. */
export type OfferedMachines = "server" | "all";

const OfferedMachinesContext = createContext<OfferedMachines>("server");

/** The host decides; without one, for example in the web app, only the server applies. */
export const OfferedMachinesProvider = OfferedMachinesContext.Provider;

export const useOfferedMachines = (): OfferedMachines => useContext(OfferedMachinesContext);
