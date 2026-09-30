import type { ReactNode } from "react";
import type { PanelAction, PanelState } from "./contract";

export interface PanelPageProps {
  readonly runDetails?: (runId: string, connection: string) => ReactNode;
  readonly state: PanelState;
  readonly send: (action: PanelAction) => void;
}
