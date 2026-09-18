import type { OverseerModelSelection, OverseerSettings } from "../contract";
import { errorFrom } from "@aicontainer/web/lib/http";

type SettingsState =
  | { status: "loading"; settings?: undefined; error?: undefined }
  | { status: "failed"; settings?: undefined; error: string }
  | { status: "ready" | "saving"; settings: OverseerSettings; error?: string };

const endpoint = "/api/plugins/ragents.overseer/settings";

export function createModelSettingsStore(request: typeof fetch = fetch) {
  let state: SettingsState = { status: "loading" };
  let revision = 0;
  let loading: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: SettingsState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const readResponse = async (response: Response): Promise<OverseerSettings> => {
    if (!response.ok) throw await errorFrom(response, "Koordinator-Einstellungen konnten nicht geladen oder gespeichert werden");
    const value = await response.json() as Partial<OverseerSettings> | null;
    if (!value || typeof value.provider !== "string" || typeof value.model !== "string" || typeof value.thinking !== "string"
      || !Array.isArray(value.models) || !value.models.every((model) => model && typeof model.id === "string"
        && typeof model.provider === "string" && typeof model.label === "string" && Array.isArray(model.thinking)
        && model.thinking.length > 0 && model.thinking.every((level) => typeof level === "string"))) {
      throw new Error("Der Server hat ungültige Koordinator-Einstellungen geliefert");
    }
    return value as OverseerSettings;
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
    loading = request(endpoint).then(readResponse).then((settings) => {
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
      const settings = await readResponse(await request(endpoint, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selection),
      }));
      publish({ status: "ready", settings });
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
