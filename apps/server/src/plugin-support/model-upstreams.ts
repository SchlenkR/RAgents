import type { Api, Model } from "@ragents/ai";
import { serviceToken, type ServiceToken } from "@ragents/engine";

/** Ein Modellanbieter, den dieser Server mit eigenem Schlüssel erreicht; das Relay reicht Aufrufe dorthin durch. */
export interface ModelUpstream {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly models: readonly Model<Api>[];
}

export const modelUpstreamsToken: ServiceToken<() => readonly ModelUpstream[]> = serviceToken("host.model-upstreams");
