import { createContext, useContext } from "react";
import type { ActorProgramsApi, ActorProgramsListing, RunAppInvocation } from "./api";
import type { JsonValue } from "./bridge";

export interface ActorProgramsContextValue {
  api: ActorProgramsApi;
  error: string | undefined;
  fullscreenAppId: string | undefined;
  listing: ActorProgramsListing | undefined;
  openFullscreen: (appId: string) => void;
  closeFullscreen: () => void;
  refresh: () => Promise<void>;
  invoke: (
    appId: string,
    revision: string,
    actionId: string,
    requestId: string,
    input: JsonValue,
  ) => Promise<RunAppInvocation>;
  runId: string;
}

export const ActorProgramsContext = createContext<ActorProgramsContextValue | undefined>(undefined);
export const useOptionalActorPrograms = () => useContext(ActorProgramsContext);

export const useActorPrograms = (): ActorProgramsContextValue => {
  const value = useOptionalActorPrograms();
  if (!value) throw new Error("Der Actor-Programm-Provider ist nicht aktiv");
  return value;
};
