import type { Api, Model } from "@ragents/ai";
import { serviceToken, type ServiceToken } from "@ragents/engine";

/** A model provider this server reaches with its own key; the relay passes calls through to it. */
export interface ModelUpstream {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly models: readonly Model<Api>[];
}

export const modelUpstreamsToken: ServiceToken<() => readonly ModelUpstream[]> = serviceToken("host.model-upstreams");
