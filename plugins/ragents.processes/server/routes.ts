import { DomainError, type HttpRouteContribution } from "@aicontainer/ragents";
import type { EventChannelProvider } from "@aicontainer/server/event-hub.js";
import { guardedJsonRoute, withAbort, writeJson } from "@aicontainer/server/plugin-support/http.js";
import { processesRunIdOf, type RunProcessMessage, type RunProcessSnapshot } from "../contract.js";
import type { ProcessTerminationContext } from "./terminator.js";

export const processesApiPrefix = "/api/plugins/ragents.processes";

const snapshotPattern = /^\/api\/plugins\/ragents\.processes\/runs\/([A-Za-z0-9_-]{1,64})\/processes$/;
const stopPattern = /^\/api\/plugins\/ragents\.processes\/runs\/([A-Za-z0-9_-]{1,64})\/processes\/([1-9]\d*-[a-f0-9]{64})\/stop$/;

export interface ProcessObservation {
  observe: (runId: string) => Promise<RunProcessSnapshot>;
  watch: (runId: string, listener: (message: RunProcessMessage) => void) => () => void;
}

export interface ProcessRouteOptions {
  observer: ProcessObservation;
  ensureSession: (runId: string) => void;
  terminate: (runId: string, processId: string, context: ProcessTerminationContext) => Promise<void>;
}

const runIdOf = (url: URL, pattern: RegExp): string => {
  const match = url.pathname.match(pattern);
  if (!match) throw new Error("Ungültige Prozess-Route");
  return match[1];
};

export const createProcessRoutes = (options: ProcessRouteOptions): HttpRouteContribution[] => [
  {
    id: "ragents.processes.snapshot",
    requiredRights: ["runs.read", "ragents.processes.read"],
    isApiPath: (pathname) => snapshotPattern.test(pathname),
    matches: (request, url) => request.method === "GET" && snapshotPattern.test(url.pathname),
    handle: async ({ request, response, url }) => {
      const runId = runIdOf(url, snapshotPattern);
      await guardedJsonRoute({
        request,
        response,
        ensureSession: () => options.ensureSession(runId),
        handle: async () => {
          writeJson(response, 200, await options.observer.observe(runId));
        },
      });
    },
  },
  {
    id: "ragents.processes.stop",
    requiredRights: ["runs.read", "runs.write", "runs.inspect"],
    isApiPath: (pathname) => stopPattern.test(pathname),
    matches: (request, url) => request.method === "POST" && stopPattern.test(url.pathname),
    handle: async ({ request, response, url, access }) => {
      const match = stopPattern.exec(url.pathname);
      if (!match) throw new Error("Ungültige Prozess-Stopp-Route");
      const [, runId, processId] = match;
      await guardedJsonRoute({
        request,
        response,
        errorStatus: 500,
        handle: async () => {
          const assertAllowed = () => {
            if (!access.can("runs.read") || !access.can("runs.write") || !access.can("runs.inspect")) throw new DomainError("forbidden", "Das Beenden von Prozessen ist nicht erlaubt", 403);
            if (request.aborted || response.destroyed) throw new Error("Die Prozess-Stopp-Anfrage wurde abgebrochen");
            options.ensureSession(runId);
          };
          assertAllowed();
          await withAbort(request, response, (signal) => options.terminate(runId, processId, { signal, assertAllowed }));
          writeJson(response, 200, { stopped: true });
        },
      });
    },
  },
];

export const createProcessChannel = (options: Pick<ProcessRouteOptions, "observer" | "ensureSession">): EventChannelProvider => ({
  id: "ragents.processes",
  matches: (channel) => processesRunIdOf(channel) !== undefined,
  requiredRights: () => ["runs.read", "ragents.processes.read"],
  open: (channel, emit) => {
    const runId = processesRunIdOf(channel)!;
    options.ensureSession(runId);
    return options.observer.watch(runId, emit);
  },
});
