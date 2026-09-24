import type { Api, Model } from "@ragents/ai";
import type { ModelProviderRegistration } from "@ragents/engine";

export const RELAY_PROVIDER = "relay";
export const RELAY_API_PATH = "/relay/v1";

export interface RelayConnection {
  readonly url: string;
  readonly token: string;
}

/** Was das Relay je Alias über das dahinterliegende Modell verrät; der echte Name bleibt beim Server. */
export interface RelayCatalogEntry {
  readonly id: string;
  readonly object: "model";
  readonly catalog: {
    readonly reasoning: boolean;
    readonly thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
    readonly input: Model<Api>["input"];
    readonly contextWindow: number;
    readonly maxTokens: number;
    readonly compat?: Model<Api>["compat"];
  };
}

export interface RelayCatalog {
  readonly baseUrl: string;
  load: () => Promise<readonly Model<Api>[]>;
  models: () => readonly Model<Api>[];
  registration: () => Promise<ModelProviderRegistration>;
}

const isEntry = (value: unknown): value is RelayCatalogEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  const catalog = entry.catalog as Record<string, unknown> | undefined;
  return typeof entry.id === "string" && entry.id.length > 0 && entry.object === "model"
    && !!catalog && typeof catalog === "object"
    && typeof catalog.reasoning === "boolean"
    && Array.isArray(catalog.input) && catalog.input.every((item) => typeof item === "string")
    && Number.isInteger(catalog.contextWindow) && Number.isInteger(catalog.maxTokens);
};

export const relayBaseUrl = (url: string): string => {
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { throw new Error(`RELAY_URL ist keine gültige Adresse: ${url}`); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`RELAY_URL braucht http oder https: ${url}`);
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}${RELAY_API_PATH}`;
};

const modelOf = (entry: RelayCatalogEntry, baseUrl: string): Model<"openai-completions"> => ({
  id: entry.id,
  name: entry.id,
  api: "openai-completions",
  provider: RELAY_PROVIDER,
  baseUrl,
  reasoning: entry.catalog.reasoning,
  ...(entry.catalog.thinkingLevelMap ? { thinkingLevelMap: entry.catalog.thinkingLevelMap } : {}),
  input: [...entry.catalog.input],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: entry.catalog.contextWindow,
  maxTokens: entry.catalog.maxTokens,
  ...(entry.catalog.compat ? { compat: entry.catalog.compat as Model<"openai-completions">["compat"] } : {}),
});

/** Holt den Aliaskatalog des Relays genau einmal; ohne erreichbares Relay ist der Start ein Fehler mit Adresse und Ursache. */
export const createRelayCatalog = (connection: RelayConnection, fetchImpl: typeof fetch = fetch): RelayCatalog => {
  const baseUrl = relayBaseUrl(connection.url);
  let loading: Promise<readonly Model<Api>[]> | undefined;
  let loaded: readonly Model<Api>[] | undefined;
  const fetchCatalog = async (): Promise<readonly Model<Api>[]> => {
    const address = `${baseUrl}/models`;
    let response: Response;
    try {
      response = await fetchImpl(address, { headers: { authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      throw new Error(`Das Modell-Relay ${address} ist nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      throw new Error(`Das Modell-Relay ${address} lehnt den Katalogabruf ab: ${response.status} ${(await response.text()).slice(0, 200)}`);
    }
    const body = await response.json() as { data?: unknown };
    if (!Array.isArray(body.data) || !body.data.every(isEntry)) throw new Error(`Das Modell-Relay ${address} liefert keinen gültigen Aliaskatalog`);
    if (body.data.length === 0) throw new Error(`Das Modell-Relay ${address} bietet keine Modelle an`);
    loaded = body.data.map((entry) => modelOf(entry, baseUrl));
    return loaded;
  };
  const load = (): Promise<readonly Model<Api>[]> => loading ??= fetchCatalog();
  return {
    baseUrl,
    load,
    models: () => {
      if (!loaded) throw new Error(`Der Modellkatalog des Relays ${baseUrl} ist noch nicht geladen`);
      return loaded;
    },
    registration: async () => ({
      id: RELAY_PROVIDER,
      config: {
        name: "Relay",
        baseUrl,
        apiKey: connection.token,
        api: "openai-completions",
        models: (await load()).map((model) => ({
          id: model.id,
          name: model.name,
          reasoning: model.reasoning,
          ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
          input: [...model.input],
          cost: model.cost,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          ...(model.compat ? { compat: model.compat } : {}),
        })),
      },
    }),
  };
};
