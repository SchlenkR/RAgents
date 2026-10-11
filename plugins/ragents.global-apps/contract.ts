import { Type, type Static, type TSchema } from "typebox";
import { defineChannel, defineOperation } from "@ragents/engine/src/rpc/contract";
import { appTriggersSchema } from "@ragents/host/plugin-support/actor-programs/contract";

export const GLOBAL_APPS_PLUGIN_ID = "ragents.global-apps";
export const globalAppsPermissions = [
  {
    id: "ragents.global-apps.read",
    description: "View your global apps on Start.",
  },
  {
    id: "ragents.global-apps.write",
    description: "Create and remove your global apps.",
  },
] as const;

const object = <P extends Record<string, TSchema>>(properties: P) => Type.Object(properties, { additionalProperties: false });
const nullableText = Type.Union([Type.String(), Type.Null()]);
const name = Type.String({
  pattern: "^[a-z][a-z0-9-]{0,63}$",
  description: "Your chosen app name; it names the app's room and package.",
});

export const appCreateSchema = object({
  name,
  program: Type.String({
    pattern: "^(?:[a-z][a-z0-9-]{0,63}\\.)?[a-z][a-z0-9-]{0,63}$",
    description: "Package in your run to copy, relative to your room; its package.json declares triggers and permissions.",
  }),
});
export const appCreatedSchema = object({
  program: Type.String({ description: "The app's package as the global coordinator's main room names it." }),
});
export const appNameSchema = object({ name });
export const appListSchema = object({
  limit: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 50,
  })),
});
export const appSummarySchema = object({
  name,
  actorId: Type.String(),
  program: Type.String(),
  description: Type.String(),
  input: Type.Boolean({ description: "Whether the app has an onInput handler that triggers reach." }),
  triggers: appTriggersSchema,
  views: Type.Array(object({ id: Type.String(), title: Type.String(), revision: Type.String() })),
  paused: Type.Boolean(),
  status: Type.Union([Type.Literal("ready"), Type.Literal("queued"), Type.Literal("running"), Type.Literal("paused"), Type.Literal("blocked")]),
  lastRunAt: nullableText,
  nextRunAt: nullableText,
  lastResult: Type.Union([object({
    outcome: Type.Union([Type.Literal("completed"), Type.Literal("failed"), Type.Literal("interrupted"), Type.Literal("timeout")]),
    at: Type.String(),
    summary: Type.String(),
  }), Type.Null()]),
  problem: nullableText,
});
export const globalAppsListResultSchema = object({
  apps: Type.Array(appSummarySchema),
  errors: Type.Array(object({ id: Type.String(), name: Type.String(), problem: Type.String() })),
  hasMore: Type.Boolean(),
});
export const globalAppsSnapshotSchema = object({
  runId: nullableText,
  revision: Type.Integer(),
  apps: Type.Array(appSummarySchema),
  errors: globalAppsListResultSchema.properties.errors,
  problem: nullableText,
});
export const removedSchema = object({ removed: Type.Literal(true) });
export const emptySchema = object({});

export type GlobalAppCreate = Static<typeof appCreateSchema>;
export type GlobalAppSummary = Static<typeof appSummarySchema>;
export type GlobalAppsSnapshot = Static<typeof globalAppsSnapshotSchema>;

export const globalAppsContracts = {
  create: defineOperation({
    id: "ragents.global-apps.create",
    description: "Copy an owned actor package into its own room of your global space and activate it there with its triggers and permissions.",
    rights: ["ragents.global-apps.write", "runs.write"],
    input: object({
      ...appCreateSchema.properties,
      sourceRunId: Type.String({ minLength: 1 }),
    }),
    result: appCreatedSchema,
    timeoutMs: 120000,
  }),
  list: defineOperation({
    id: "ragents.global-apps.list",
    description: "List your global apps with their trigger progress.",
    rights: ["ragents.global-apps.read"],
    input: appListSchema,
    result: globalAppsListResultSchema,
  }),
  remove: defineOperation({
    id: "ragents.global-apps.remove",
    description: "Stop and remove an app, retaining its journal history.",
    rights: ["ragents.global-apps.write", "runs.write"],
    input: appNameSchema,
    result: removedSchema,
  }),
  changed: defineChannel({
    id: "ragents.global-apps.changed",
    description: "Your current global apps after every change and reconnect.",
    rights: ["ragents.global-apps.read"],
    params: emptySchema,
    message: globalAppsSnapshotSchema,
  }),
};
