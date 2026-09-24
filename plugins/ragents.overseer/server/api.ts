import path from "node:path";
import type { Static } from "typebox";
import { DomainError, implement, type AccessContext, type JsonValue, type MethodContribution, type PluginHost } from "@ragents/engine";
import { methodReference, openRpcDocument, type ApiAuthentication } from "@ragents/host/api/reference.js";
import type { RunManagement } from "@ragents/host/ragents/global-chat.js";
import { overseerContracts } from "../contract.js";
import { coordinatorRunIdOf } from "./coordinator.js";
import type { RunDirectory } from "./run-directory.js";

export interface ManagementContext {
  root: PluginHost;
  management: () => RunManagement;
  directory: RunDirectory;
  authentication: ApiAuthentication;
}

type CreateInput = Static<typeof overseerContracts.createRun.input>;

const identity = (found: { id: string; title: string; reference: string }) => ({ runId: found.id, title: found.title, reference: found.reference });

/** Aufgelöst wird nur über die Runs des Aufrufers; ein fremder Run ist hier so unbekannt wie ein nicht vorhandener. */
const resolve = async (context: ManagementContext, access: AccessContext, reference: string) => {
  const runs = await context.management().list(access);
  const exact = runs.find((entry) => entry.id === reference);
  if (exact) return (await context.directory.describe(runs)).find((entry) => entry.id === exact.id)!;
  return context.directory.resolve(reference, runs);
};

const create = async (context: ManagementContext, body: CreateInput, access: AccessContext) => {
  const common = {
    title: body.title.trim(),
    user: access.user ? { id: access.user.id, label: access.user.label } : null,
    ...(body.options ? { options: body.options as Record<string, JsonValue> } : {}),
  };
  const runId = await (async () => {
    if ("packageDirectory" in body) {
      if (!path.isAbsolute(body.packageDirectory)) throw new DomainError("invalid-package-directory", "packageDirectory muss ein absoluter Serverpfad sein", 400);
      return context.management().create({ ...common, kind: "package", directory: body.packageDirectory, input: (body.input ?? null) as JsonValue });
    }
    if ("script" in body) {
      const entries = context.root.startEntries.describe().filter((entry) => entry.action === "script");
      const wanted = body.script.trim().toLocaleLowerCase("de");
      const direct = entries.find((entry) => entry.id === body.script.trim());
      const matching = direct ? [direct] : entries.filter((entry) => entry.title.toLocaleLowerCase("de") === wanted);
      if (matching.length !== 1) throw new DomainError("invalid-script", `Das Run-Script ist unbekannt oder mehrdeutig. Gültige Titel und Kennungen: ${entries.map((entry) => `${entry.title} (${entry.id})`).join(", ") || "keine"}`, 400);
      return context.management().create({ ...common, kind: "script", entryId: matching[0].id, input: (body.input ?? null) as JsonValue });
    }
    return context.management().create({ ...common, kind: "message", message: body.message.trim() });
  })();
  const found = (await context.directory.describe(await context.management().list())).find((entry) => entry.id === runId);
  if (!found) throw new DomainError("run-unavailable", "Der erstellte Run ist nicht mehr verfügbar", 409);
  return { ...identity(found), accepted: true as const };
};

export function managementMethods(context: ManagementContext): MethodContribution[] {
  return [
    implement(overseerContracts.listRuns, async (_input, { access }) =>
      (await context.directory.describe(await context.management().list(access))).map((entry) => {
        const { createdAt, running, metadata } = entry as typeof entry & { running?: boolean; metadata?: Record<string, JsonValue> };
        return { ...identity(entry), updatedAt: entry.updatedAt, ...(createdAt !== undefined ? { createdAt } : {}), ...(running !== undefined ? { running } : {}), ...(metadata ? { metadata } : {}) };
      })),
    implement(overseerContracts.createRun, (input, { access }) => create(context, input, access)),
    implement(overseerContracts.readRun, async ({ run }, { access }) => context.management().view((await resolve(context, access, run)).id)),
    implement(overseerContracts.readEvents, async ({ run, after, limit, type }, { access }) => {
      const found = await resolve(context, access, run);
      const events = context.management().events(found.id).filter((event) => event.sequence > (after ?? 0) && (!type || event.type === type));
      const selected = events.slice(0, limit ?? 50);
      return { ...identity(found), events: selected, nextAfter: selected.at(-1)?.sequence ?? after ?? 0, hasMore: events.length > selected.length };
    }),
    implement(overseerContracts.sendMessage, async ({ run, message }, { access }) => {
      const found = await resolve(context, access, run);
      await context.management().send(found.id, message.trim(), access);
      return { ...identity(found), accepted: true as const };
    }),
    implement(overseerContracts.stopRun, async ({ run }, { access }) => {
      const found = await resolve(context, access, run);
      await context.management().stop(found.id);
      return { ...identity(found), stopped: true as const };
    }),
    implement(overseerContracts.readCatalog, (_input, { access }) => ({
      entries: [...context.root.startEntries.describe()],
      options: context.root.startOptions.entries().map(({ option }) => {
        const scope = { runId: coordinatorRunIdOf(access), userId: access.user?.id ?? null };
        const value = context.root.startOptions.defaultValue(option.id, scope);
        return { id: option.id, schema: option.schema, value, selectable: option.selectable(), presentation: option.describe(value, scope) };
      }),
    })),
    implement(overseerContracts.coordinator, (_input, { access }) => ({ runId: coordinatorRunIdOf(access) })),
    implement(overseerContracts.readReference, () => methodReference(context.root, context.authentication)),
    implement(overseerContracts.readOpenRpc, () => openRpcDocument(context.root, context.authentication)),
  ];
}
