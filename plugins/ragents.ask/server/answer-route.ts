import type { HttpRouteContribution } from "@aicontainer/ragents";
import { guardedJsonRoute, readJsonBody, writeJson } from "@aicontainer/server/plugin-support/http.js";
import type { RuntimeAskService } from "./ask-service.js";

export const askApiPrefix = "/api/plugins/ragents.ask";

const routePattern = /^\/api\/plugins\/ragents\.ask\/runs\/([A-Za-z0-9_-]{1,64})\/questions\/([A-Za-z0-9_-]{1,80})\/answer$/;

interface AnswerBody {
  answer?: string;
  dismiss?: boolean;
}

const answerBodyFrom = (body: unknown): AnswerBody => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Der Request-Body muss ein Objekt sein");
  }
  const { answer, dismiss } = body as { answer?: unknown; dismiss?: unknown };
  if (answer !== undefined && typeof answer !== "string") throw new Error("answer muss ein String sein");
  if (dismiss !== undefined && typeof dismiss !== "boolean") throw new Error("dismiss muss ein Boolean sein");
  if (dismiss !== true && (typeof answer !== "string" || answer.trim() === "")) {
    throw new Error("answer ist erforderlich, wenn nicht verworfen wird");
  }
  return { ...(answer !== undefined ? { answer } : {}), ...(dismiss !== undefined ? { dismiss } : {}) };
};

export const createAnswerRoute = (
  service: RuntimeAskService,
  ensureSession: (runId: string) => void,
): HttpRouteContribution => ({
  id: "ragents.ask.answer",
  isApiPath: (pathname) => routePattern.test(pathname),
  matches: (request, url) => request.method === "POST" && routePattern.test(url.pathname),
  handle: async ({ request, response, url }) => {
    const match = url.pathname.match(routePattern);
    if (!match) throw new Error("Ungültige Ask-Route");
    const [, runId, actionId] = match;
    await guardedJsonRoute({
      response,
      request,
      ensureSession: () => ensureSession(runId),
      handle: async () => {
        const body = await readJsonBody(request, answerBodyFrom);
        service.answer(runId, actionId, body);
        writeJson(response, 200, { ok: true });
      },
    });
  },
});
