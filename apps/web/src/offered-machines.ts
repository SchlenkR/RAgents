import { createContext, useContext } from "react";

/** Wo eine Oberfläche neue Runs anbietet: der Browser nur auf dem Server, VS Code als Arbeitsplatz auch auf Arbeitsplätzen. */
export type OfferedMachines = "server" | "all";

const OfferedMachinesContext = createContext<OfferedMachines>("server");

/** Der Host legt es fest; ohne ihn, etwa in der Web-App, gilt nur der Server. */
export const OfferedMachinesProvider = OfferedMachinesContext.Provider;

export const useOfferedMachines = (): OfferedMachines => useContext(OfferedMachinesContext);
