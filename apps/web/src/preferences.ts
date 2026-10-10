import type { JsonValue } from "@ragents/engine/src/domain/json";
import { coreContracts } from "@ragents/host/api/contracts";
import type { PreferenceKey } from "@ragents/host/preferences-contract";
import { rpc } from "./rpc";

/** The viewer's own preferences on the server, the same in the browser and in VS Code. */
export interface PreferenceStore {
  /** Null when nothing is stored. */
  read: (key: PreferenceKey) => Promise<JsonValue | null>;
  /** Null removes the stored value. */
  write: (key: PreferenceKey, value: JsonValue | null) => Promise<void>;
}

export const SERVER_PREFERENCES: PreferenceStore = {
  read: (key) => rpc.call(coreContracts.preferences.read, { key }),
  write: async (key, value) => { await rpc.call(coreContracts.preferences.write, { key, value }); },
};
