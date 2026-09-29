import { RpcClient } from "../../../apps/web/src/rpc/client";
import type { WorkspaceClientTransport } from "./workspace-client";

/** A workstation access without a user interface: the message layer with a bearer token. */
export const workspaceClientTransport = (baseUrl: string, token: string | undefined): WorkspaceClientTransport => ({
  rpc: new RpcClient({
    baseUrl: new URL(baseUrl).origin,
    fetch: (input, init) => {
      const headers = init?.headers as Record<string, string> | undefined ?? {};
      return fetch(input, { ...init, headers: token === undefined ? headers : { ...headers, authorization: `Bearer ${token}` } });
    },
  }),
});
