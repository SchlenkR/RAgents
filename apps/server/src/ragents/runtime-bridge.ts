import { serviceToken, type Orchestration, type ServiceToken } from "@aicontainer/ragents";

export interface RuntimeBridge {
  bind: (runtime: Orchestration) => void;
}

export const runtimeBridgeToken: ServiceToken<RuntimeBridge> = serviceToken("ragents.runtime-bridge");
