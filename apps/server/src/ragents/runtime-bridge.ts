import { serviceToken, type Orchestration, type ServiceToken } from "@ragents/engine";

export interface RuntimeBridge {
  bind: (runtime: Orchestration) => void;
}

export const runtimeBridgeToken: ServiceToken<RuntimeBridge> = serviceToken("ragents.runtime-bridge");
