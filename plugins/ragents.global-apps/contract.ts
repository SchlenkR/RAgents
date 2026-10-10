import { Type, type Static, type TSchema } from "typebox";
import { defineChannel, defineOperation } from "@ragents/engine/src/rpc/contract";

export const GLOBAL_APPS_PLUGIN_ID = "ragents.global-apps";
export const globalAppsPermissions = [
  {
    id: "ragents.global-apps.read",
    description: "View your global apps, their state and recent logs.",
  },
  {
    id: "ragents.global-apps.write",
    description: "Register, verify, pause and remove your global apps.",
  },
] as const;

const object = <P extends Record<string, TSchema>>(properties: P) => Type.Object(properties, { additionalProperties: false });
const names = () => Type.Array(Type.String({
  minLength: 1,
  maxLength: 512,
}), {
  maxItems: 16,
  uniqueItems: true,
});
const name = Type.String({
  pattern: "^[a-z][a-z0-9-]{0,63}$",
  description: "Your chosen app name.",
});

export const appPermissionsSchema = object({
  files: Type.Optional(object({
    read: Type.Optional(names()),
    write: Type.Optional(names()),
  })),
  http: Type.Optional(names()),
  functions: Type.Optional(Type.Array(Type.String({
    minLength: 1,
    maxLength: 128,
  }), {
    maxItems: 32,
    uniqueItems: true,
  })),
});

export const appTriggersSchema = object({
  interval: Type.Optional(object({
    everySeconds: Type.Integer({ minimum: 60, maximum: 604800 }),
  })),
  fileChange: Type.Optional(object({ folders: names() })),
});

export const appRegisterSchema = object({
  name,
  description: Type.String({
    minLength: 1,
    maxLength: 1000,
    pattern: "\\S",
  }),
  program: Type.String({
    pattern: "^(?:[a-z][a-z0-9-]{0,63}\\.)?[a-z][a-z0-9-]{0,63}$",
    description: "Private actor package in your run, relative to your room.",
  }),
  triggers: Type.Optional(appTriggersSchema),
  timeoutSeconds: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 300,
  })),
  permissions: appPermissionsSchema,
});

export const appNameSchema = object({ name });
export const appListSchema = object({
  limit: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 50,
  })),
});
export const appReadSchema = object({
  name,
  logLimit: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 100,
  })),
});
export const appPauseSchema = object({
  name,
  paused: Type.Boolean(),
});
export const appTriggerSchema = object({
  key: Type.String(),
  scheduledAt: Type.String(),
  reason: Type.Union([Type.Literal("interval"), Type.Literal("manual"), Type.Literal("file-change")]),
});
export const appResultSchema = object({
  outcome: Type.Union([Type.Literal("completed"), Type.Literal("failed"), Type.Literal("interrupted"), Type.Literal("timeout")]),
  at: Type.String(),
  summary: Type.String(),
});
export const appSummarySchema = object({
  name,
  description: Type.String(),
  triggers: appTriggersSchema,
  views: Type.Array(object({ id: Type.String(), title: Type.String(), revision: Type.String() })),
  paused: Type.Boolean(),
  status: Type.Union([Type.Literal("ready"), Type.Literal("queued"), Type.Literal("running"), Type.Literal("paused"), Type.Literal("blocked")]),
  lastRunAt: Type.Union([Type.String(), Type.Null()]),
  nextRunAt: Type.Union([Type.String(), Type.Null()]),
  lastResult: Type.Union([appResultSchema, Type.Null()]),
  problem: Type.Union([Type.String(), Type.Null()]),
});
export const appLogSchema = object({
  at: Type.String(),
  occurrence: Type.Integer(),
  level: Type.Union([Type.Literal("info"), Type.Literal("error")]),
  text: Type.String(),
});
export const appDetailsSchema = object({
  app: appSummarySchema,
  definition: appRegisterSchema,
  timeoutSeconds: Type.Integer(),
  permissions: appPermissionsSchema,
  sandbox: Type.Union([Type.Literal("process"), Type.Literal("disabled"), Type.Literal("unavailable")]),
  source: object({
    runId: Type.String(),
    program: Type.String(),
  }),
  state: Type.Unknown(),
  log: Type.Array(appLogSchema),
  droppedLogLines: Type.Integer(),
});
export const globalAppsListResultSchema = object({
  apps: Type.Array(appSummarySchema),
  errors: Type.Array(object({ id: Type.String(), name: Type.String(), problem: Type.String() })),
  hasMore: Type.Boolean(),
});
export const globalAppsSnapshotSchema = object({
  runId: Type.Union([Type.String(), Type.Null()]),
  revision: Type.Integer(),
  apps: Type.Array(appSummarySchema),
  errors: globalAppsListResultSchema.properties.errors,
  problem: Type.Union([Type.String(), Type.Null()]),
});
export const registeredSchema = object({
  registered: Type.Literal(true),
  paused: Type.Literal(true),
});
export const acceptedSchema = object({ accepted: Type.Literal(true) });
export const changedSchema = object({ changed: Type.Boolean() });
export const removedSchema = object({ removed: Type.Literal(true) });
export const emptySchema = object({});
export const appFileReadSchema = object({ path: Type.String({ minLength: 1 }) });
export const appFileWriteSchema = object({
  path: Type.String({ minLength: 1 }),
  content: Type.String({ maxLength: 250000 }),
});
export const appHttpSchema = object({
  url: Type.String({
    minLength: 1,
    maxLength: 4096,
  }),
  method: Type.Optional(Type.Union([Type.Literal("GET"), Type.Literal("POST"), Type.Literal("PUT"), Type.Literal("PATCH"), Type.Literal("DELETE")])),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  body: Type.Optional(Type.String({ maxLength: 250000 })),
});
export const appHttpResultSchema = object({
  status: Type.Integer(),
  body: Type.String(),
});

export type GlobalAppRegister = Static<typeof appRegisterSchema>;
export type GlobalAppPermissions = Static<typeof appPermissionsSchema>;
export type GlobalAppSummary = Static<typeof appSummarySchema>;
export type GlobalAppDetails = Static<typeof appDetailsSchema>;
export type GlobalAppTrigger = Static<typeof appTriggerSchema>;
export type GlobalAppLog = Static<typeof appLogSchema>;
export type GlobalAppResult = Static<typeof appResultSchema>;
export type GlobalAppsSnapshot = Static<typeof globalAppsSnapshotSchema>;
export type GlobalAppHttpRequest = Static<typeof appHttpSchema>;

export const globalAppsContracts = {
  view: defineOperation({
    id: "ragents.global-apps.view",
    description: "Read one view of your registered global app.",
    rights: ["ragents.global-apps.read", "runs.read"],
    input: object({ name, viewId: Type.String() }),
    result: Type.Unknown(),
  }),
  register: defineOperation({
    id: "ragents.global-apps.register",
    description: "Copy, check and register an owned actor package as a paused global app.",
    rights: ["ragents.global-apps.write", "runs.write"],
    input: object({
      ...appRegisterSchema.properties,
      sourceRunId: Type.String({ minLength: 1 }),
    }),
    result: registeredSchema,
    timeoutMs: 120000,
  }),
  list: defineOperation({
    id: "ragents.global-apps.list",
    description: "List your global apps.",
    rights: ["ragents.global-apps.read"],
    input: appListSchema,
    result: globalAppsListResultSchema,
  }),
  read: defineOperation({
    id: "ragents.global-apps.read",
    description: "Read an app, permissions, state and bounded log.",
    rights: ["ragents.global-apps.read"],
    input: appReadSchema,
    result: appDetailsSchema,
  }),
  run: defineOperation({
    id: "ragents.global-apps.run",
    description: "Queue one immediate check, including while paused.",
    rights: ["ragents.global-apps.write", "runs.write"],
    input: appNameSchema,
    result: acceptedSchema,
  }),
  pause: defineOperation({
    id: "ragents.global-apps.pause",
    description: "Pause or resume an app.",
    rights: ["ragents.global-apps.write", "runs.write"],
    input: appPauseSchema,
    result: changedSchema,
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
