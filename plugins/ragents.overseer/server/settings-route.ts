import type { HttpRouteContribution } from "@aicontainer/ragents";
import { guardedJsonRoute, readJsonBody, writeJson } from "@aicontainer/server/plugin-support/http.js";
import type { OverseerModelSettings } from "./settings.js";

const route = "/api/plugins/ragents.overseer/settings";

export const createSettingsRoute = (settings: OverseerModelSettings): HttpRouteContribution => ({
  id: "settings",
  isApiPath: (pathname) => pathname === route,
  matches: (_request, url) => url.pathname === route,
  requiredRights: (request) => request.method === "GET"
    ? ["ragents.overseer.read"] : ["ragents.overseer.read", "ragents.overseer.write", "settings.write"],
  handle: ({ request, response }) => guardedJsonRoute({
    request, response,
    handle: async () => {
      if (request.method === "GET") writeJson(response, 200, settings.get());
      else if (request.method === "PUT") writeJson(response, 200, await settings.save(await readJsonBody(request, (value) => value, undefined, 4096)));
      else writeJson(response, 405, { error: "Erlaubt sind GET und PUT." });
    },
  }),
});
