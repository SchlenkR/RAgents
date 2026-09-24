import { rpc } from "@ragents/web/rpc";
import { overseerContracts, type OverseerModelSelection, type OverseerSettings } from "../contract";

type SettingsState =
  | { status: "loading"; settings?: undefined; error?: undefined }
  | { status: "failed"; settings?: undefined; error: string }
  | { status: "ready" | "saving"; settings: OverseerSettings; error?: string };

export interface ModelSettingsApi {
  read: () => Promise<OverseerSettings>;
  save: (selection: OverseerModelSelection) => Promise<OverseerSettings>;
}

const rpcApi: ModelSettingsApi = {
  read: () => rpc.call(overseerContracts.settings.read, {}),
  save: (selection) => rpc.call(overseerContracts.settings.save, selection),
};

export function createModelSettingsStore(api: ModelSettingsApi = rpcApi) {
  let state: SettingsState = { status: "loading" };
  let revision = 0;
  let loading: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: SettingsState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const failure = (cause: unknown) => {
    const error = cause instanceof Error ? cause.message : String(cause);
    publish(state.settings ? { status: "ready", settings: state.settings, error } : { status: "failed", error });
  };
  const load = (): Promise<void> => {
    if (loading) return loading;
    if (state.status === "saving") return Promise.resolve();
    const started = revision;
    if (!state.settings) publish({ status: "loading" });
    loading = api.read().then((settings) => {
      if (revision === started) publish({ status: "ready", settings });
    }).catch((cause: unknown) => {
      if (revision === started) failure(cause);
    }).finally(() => { loading = undefined; });
    return loading;
  };
  const save = async (selection: OverseerModelSelection): Promise<void> => {
    if (!state.settings || state.status === "saving") throw new Error("Warte, bis die Einstellungen bereit sind");
    revision += 1;
    publish({ status: "saving", settings: state.settings });
    try {
      publish({ status: "ready", settings: await api.save(selection) });
    } catch (cause) {
      failure(cause);
      throw cause;
    }
  };
  return { read: () => state, load, save, subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  } };
}

export const modelSettingsStore = createModelSettingsStore();
