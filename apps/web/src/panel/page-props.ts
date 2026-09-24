import type { PanelAction, PanelState } from "./contract";

export interface PanelPageProps {
  readonly state: PanelState;
  readonly send: (action: PanelAction) => void;
}
