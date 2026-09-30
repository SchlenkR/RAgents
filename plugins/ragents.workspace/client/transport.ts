import { ServerClient } from "../../../apps/web/src/server-client";

export const workspaceClientTransport = (baseUrl: string, token: string | undefined, environment: NodeJS.ProcessEnv = process.env): ServerClient =>
  new ServerClient(baseUrl, token, fetch, {
    log: (line) => console.error(line),
    credentials: async () => {
      const id = environment.RAGENTS_USER;
      const password = environment.RAGENTS_PASSWORD;
      return id && password ? { id, password } : undefined;
    },
  });
