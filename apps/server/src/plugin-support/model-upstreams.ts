import type { Api, Model } from "@ragents/ai";

/** A model provider this server reaches with its own key; the relay passes calls through to it. */
export interface ModelUpstream {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly models: readonly Model<Api>[];
}
