import { DomainError, type HttpRouteContribution } from "@aicontainer/ragents";
import { guardedJsonRoute, readJsonBody, writeJson } from "@aicontainer/server/plugin-support/http.js";

export const createResetRoute = (reset: () => Promise<void>): HttpRouteContribution => ({
  id: "reset",
  isApiPath: (pathname) => pathname === "/api/plugins/ragents.overseer/reset",
  matches: (_request, url) => url.pathname === "/api/plugins/ragents.overseer/reset",
  requiredRights: ["ragents.overseer.read", "ragents.overseer.write"],
  handle: ({ request, response }) => guardedJsonRoute({
    request, response,
    errorStatus: 500,
    handle: async () => {
      if (request.method !== "POST") { writeJson(response, 405, { error: "Erlaubt ist POST." }); return; }
      try {
        await readJsonBody(request, (value) => {
          if (!value || typeof value !== "object" || Array.isArray(value) || !("confirm" in value) || value.confirm !== true || Object.keys(value).length !== 1) {
            throw new DomainError("conversation-reset-confirmation", "Der Gesprächsreset muss ausdrücklich mit confirm: true bestätigt werden.", 400);
          }
        }, undefined, 4096);
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new DomainError("conversation-reset-invalid", "Der Gesprächsreset benötigt ein gültiges JSON-Objekt mit confirm: true.", 400);
      }
      await reset();
      writeJson(response, 200, { ok: true });
    },
  }),
});
