import type { HttpRouteContribution } from "@aicontainer/ragents";
import { guardedJsonRoute, writeJson } from "../http.js";
import { languageServerRoutePrefix } from "./contract.js";
import type { LanguageServerHost } from "./host.js";

export interface LanguageServerRouteOptions {
  pluginId: string;
  servers: LanguageServerHost;
  ensureSession: (runId: string) => void;
}

export const createLanguageServerRoutes = (options: LanguageServerRouteOptions): HttpRouteContribution[] => {
  const prefix = languageServerRoutePrefix(options.pluginId).replaceAll(".", "\\.");
  const pattern = new RegExp(`^${prefix}\/runs\/([A-Za-z0-9_-]{1,64})\/language-server$`);
  return [{
    id: `${options.pluginId}.snapshot`,
    requiredRights: ["runs.read", `${options.pluginId}.read`],
    isApiPath: (pathname) => pattern.test(pathname),
    matches: (request, url) => request.method === "GET" && pattern.test(url.pathname),
    handle: async ({ request, response, url }) => {
      const match = url.pathname.match(pattern);
      if (!match) throw new Error("Ungültige Sprachserver-Route");
      const [, runId] = match;
      await guardedJsonRoute({
        request,
        response,
        ensureSession: () => options.ensureSession(runId),
        handle: async () => writeJson(response, 200, await options.servers.snapshot(runId)),
      });
    },
  }];
};
