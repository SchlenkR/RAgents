import { serviceToken } from "@ragents/engine";

export interface RunSecurityPolicy {
  readonly restricted: boolean;
}

export const runSecurityPolicyToken = serviceToken<(runId: string) => RunSecurityPolicy>("ragents.workspace.run-security");
