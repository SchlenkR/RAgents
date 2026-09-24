import { RpcClient } from "../../../apps/web/src/rpc/client";
import type { WorkspaceClientTransport } from "./workspace-client";

/** Ein Arbeitsplatz-Zugang ohne Oberfläche: die Nachrichtenschicht mit Bearer-Token. */
export const workspaceClientTransport = (baseUrl: string, token: string | undefined): WorkspaceClientTransport => ({
  rpc: new RpcClient({
    baseUrl: new URL(baseUrl).origin,
    fetch: (input, init) => {
      const headers = init?.headers as Record<string, string> | undefined ?? {};
      return fetch(input, { ...init, headers: token === undefined ? headers : { ...headers, authorization: `Bearer ${token}` } });
    },
  }),
});
