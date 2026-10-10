import type { PanelAction, PanelState } from "./contract";
import type { PluginRegistry } from "../PluginRegistry";
import type { PreferenceStore } from "../preferences";

export interface PanelPageProps {
  readonly state: PanelState;
  readonly send: (action: PanelAction) => void;
  readonly registry?: PluginRegistry;
  /** The viewer's preferences on the server, where Start keeps its layout; without them, as in the local VS Code shell, Start shows its default layout and no Edit. */
  readonly preferences?: PreferenceStore;
}
