import type { WorkspaceExecutorMachine, WorkspaceModuleFactory } from "@ragents/workspace-executor";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { McpServers } from "@ragents/plugins/ragents.mcp/server/service.js";
import { parseAcpAgents } from "../config.js";
import { ACP_OPERATIONS, type AcpOpened } from "./contract.js";
import { AcpSession } from "./session.js";

interface Connection {
  readonly controller: AbortController;
  readonly opened: Promise<AcpOpened & { notices: readonly string[] }>;
  session?: AcpSession;
  closed: boolean;
}

const fields = (input: unknown): Record<string, unknown> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("ACP operation needs an object");
  return input as Record<string, unknown>;
};

export const acpModule = (machine: WorkspaceExecutorMachine): WorkspaceModuleFactory => (host) => {
  const runs = new Map<string, Map<string, Connection>>();
  const actorIdOf = (input: Record<string, unknown>): string => {
    if (typeof input.actorId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.actorId)) throw new Error("ACP operation needs an actor id");
    return input.actorId;
  };
  const connection = (runId: string, actorId: string): Connection => {
    const found = runs.get(runId)?.get(actorId);
    if (!found || found.closed) throw new Error("ACP actor is not connected");
    return found;
  };
  const session = async (runId: string, actorId: string): Promise<AcpSession> => {
    const state = connection(runId, actorId);
    await state.opened;
    if (!state.session || state.closed) throw new Error("ACP actor closed while connecting");
    return state.session;
  };
  const closeActor = async (runId: string, actorId: string): Promise<void> => {
    const state = runs.get(runId)?.get(actorId);
    if (!state) return;
    state.closed = true;
    state.controller.abort();
    await state.session?.close();
    await state.opened.catch(() => undefined);
    if (runs.get(runId)?.get(actorId) === state) runs.get(runId)?.delete(actorId);
    if (runs.get(runId)?.size === 0) runs.delete(runId);
  };
  const closeRun = async (runId: string): Promise<void> => {
    const results = await Promise.allSettled([...(runs.get(runId)?.keys() ?? [])].map((id) => closeActor(runId, id)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  };
  return {
    operations: {
      [ACP_OPERATIONS.open]: async ({ runId, input, signal }) => {
        signal?.throwIfAborted();
        const value = fields(input);
        const actorId = actorIdOf(value);
        const previous = runs.get(runId)?.get(actorId);
        if (previous && !previous.closed) return previous.opened;
        const definition = parseAcpAgents({ adapter: value.definition }).adapter!;
        if (value.sessionId !== undefined && (typeof value.sessionId !== "string" || !value.sessionId)) throw new Error("ACP saved session id is invalid");
        const servers = value.mcpServers === undefined ? {} : fields(value.mcpServers) as McpServers;
        const actors = runs.get(runId) ?? new Map<string, Connection>();
        runs.set(runId, actors);
        const controller = new AbortController();
        const state: Connection = { controller, closed: false, opened: Promise.resolve().then(async () => {
          const context = await host.contextFor(runId);
          if (state.closed) throw new Error("ACP actor stopped while obtaining its workspace");
          state.session = new AcpSession(machine, host, context, definition, servers);
          const opened = await state.session.open(value.sessionId as string | undefined, AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]));
          if (state.closed) { await state.session.close(); throw new Error("ACP actor stopped while opening"); }
          return opened;
        }).catch((cause: unknown) => { if (actors.get(actorId) === state) actors.delete(actorId); throw cause; }) };
        actors.set(actorId, state);
        return state.opened;
      },
      [ACP_OPERATIONS.prompt]: async ({ runId, input, signal, progress }) => {
        if (!signal || !progress) throw new Error("ACP prompt requires a signal and progress listener");
        const value = fields(input);
        if (!Array.isArray(value.prompt)) throw new Error("ACP prompt requires content blocks");
        return (await session(runId, actorIdOf(value))).prompt(value.prompt as ContentBlock[], progress, signal);
      },
      [ACP_OPERATIONS.permission]: async ({ runId, input }) => {
        const value = fields(input);
        if (typeof value.request !== "string" || (value.label !== undefined && typeof value.label !== "string")) throw new Error("ACP permission answer needs its request and an optional selected label");
        (await session(runId, actorIdOf(value))).answerPermission(value.request, value.label as string | undefined);
        return null;
      },
      [ACP_OPERATIONS.close]: async ({ runId, input }) => {
        const value = fields(input);
        if (value.actorId === undefined) await closeRun(runId);
        else await closeActor(runId, actorIdOf(value));
        return null;
      },
    },
    backgroundGroups: () => [...runs.values()].flatMap((actors) => [...actors.values()].flatMap((state) => state.session?.pid ? [state.session.pid] : [])),
    stopRun: closeRun,
    shutdown: async () => { const results = await Promise.allSettled([...runs.keys()].map(closeRun)); const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected"); if (failed) throw failed.reason; },
  };
};
