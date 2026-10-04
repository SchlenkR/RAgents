import type { PanelAction, PanelState } from "./contract";
import type { PluginRegistry } from "../PluginRegistry";

export interface PanelPageProps {
  readonly state: PanelState;
  readonly send: (action: PanelAction) => void;
  readonly registry?: PluginRegistry;
}
