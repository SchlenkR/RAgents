import { Type, type Static, type TSchema } from "typebox";
import { defineChannel, defineOperation } from "@ragents/engine/src/rpc/contract";
import { openJson } from "@ragents/engine/src/http/contracts";
import { ACTOR_VIEW_ID_MAX_LENGTH, type ActorViewListing } from "@ragents/host/plugin-support/actor-programs/contract";

/** The run state of the read-only displays a run shows of apps that live in other runs. */
export const APP_DISPLAYS_STATE_ID = "ragents.actor-programs.displays";
export const MAX_APP_DISPLAYS = 24;

const object = <P extends Record<string, TSchema>>(properties: P) => Type.Object(properties, { additionalProperties: false });
const runId = Type.String({ pattern: "^[A-Za-z0-9_-]{1,64}$", description: "Identifier of the run" });
const displayId = Type.String({ pattern: "^[a-f0-9]{12}$", description: "Identifier of the display in its run" });
const viewId = Type.String({ pattern: `^[a-z][a-z0-9_.-]{0,${ACTOR_VIEW_ID_MAX_LENGTH - 1}}$`, description: "Identifier of the actor view" });
const label = Type.String({ minLength: 1, maxLength: 300 });

export const appDisplaySchema = object({
  id: displayId,
  title: label,
  /** Where the app lives, as the display names it: a named app with its source, or a run with its title. */
  from: label,
  source: object({ runId, actorId: Type.String({ minLength: 1, maxLength: 200 }), view: Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" }) }),
  /** The name a plugin offers the app under, such as a global app's; app_display_remove addresses it. */
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
});
export const appDisplayStateSchema = object({ version: Type.Literal(1), displays: Type.Array(appDisplaySchema, { maxItems: MAX_APP_DISPLAYS }) });
export type AppDisplay = Static<typeof appDisplaySchema>;
export type AppDisplayState = Static<typeof appDisplayStateSchema>;

/** The surface element of a display; view IDs always hold "--", so no app shares it. */
export const appDisplayElementId = (id: string): string => `display-${id}`;

const choiceSchema = object({
  title: label,
  detail: Type.Union([label, Type.Null()]),
  runId,
  view: viewId,
  shown: Type.Boolean({ description: "This run already shows the view" }),
});
const unavailable = (status: "denied" | "removed" | "failed") => object({
  status: Type.Literal(status),
  title: label,
  from: Type.Union([label, Type.Null()]),
  message: Type.String({ minLength: 1 }),
});
const groupSchema = object({ label, apps: Type.Array(choiceSchema) });
export const appDisplaySnapshotSchema = Type.Union([
  object({ status: Type.Literal("ready"), title: label, from: label, runId, app: openJson<ActorViewListing>("ActorViewListing") }),
  unavailable("denied"),
  unavailable("removed"),
  unavailable("failed"),
]);
export type AppDisplayChoice = Static<typeof choiceSchema>;
export type AppDisplayGroup = Static<typeof groupSchema>;
export type AppDisplaySnapshot = Static<typeof appDisplaySnapshotSchema>;

export const appDisplayContracts = {
  sources: defineOperation({
    id: "ragents.actor-programs.display-sources",
    description: "The apps you can show read-only in this run: named apps such as global apps, and the apps of your other runs grouped by run title.",
    rights: ["runs.read"],
    input: object({ runId }),
    result: object({ groups: Type.Array(groupSchema) }),
  }),
  add: defineOperation({
    id: "ragents.actor-programs.display-add",
    description: "Show an app of another run read-only in this run; showing the same view again returns its display.",
    rights: ["runs.read", "runs.write"],
    input: object({ runId, source: object({ runId, view: viewId }) }),
    result: object({ elementId: Type.String({ minLength: 1 }) }),
  }),
  remove: defineOperation({
    id: "ragents.actor-programs.display-remove",
    description: "Remove a display from this run; the app in its own run stays as it is.",
    rights: ["runs.read", "runs.write"],
    input: object({ runId, display: displayId }),
    result: object({}),
  }),
  display: defineChannel({
    id: "ragents.actor-programs.display",
    description: "The current state of a display's app after every change, checked against your access to the app's run.",
    rights: ["runs.read"],
    params: object({ runId, display: displayId }),
    message: appDisplaySnapshotSchema,
  }),
};
