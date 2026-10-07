import { Type, type Static } from "typebox";
import type { PublicPluginProfile } from "@ragents/engine/src/plugin-types";
import { defineChannel, defineOperation } from "@ragents/engine/src/rpc/contract";
import { openJson, runContracts } from "@ragents/engine/src/http/contracts";
import type { ChatAttachmentCapabilities, ChatEvent } from "quassel/events";
import type { ChatUserLocation } from "../chat-context.js";
import type { ListedSession } from "../chat-handler.js";
import type { ActorConversations } from "../ragents/actor-chat-history.js";
import type { StartOptionState } from "../plugin-support/start-options-contract.js";
import type { RunPreparationRequest, RunPreparationResponse } from "../run-preparation-contract.js";
import type { RunTransferExport, RunTransferImport } from "../run-transfer.js";
import type { SettingsResponse, SettingsSkillDetail } from "../settings.js";
import type { TitleModelSettings } from "../title-settings-contract.js";

export { runContracts };

const runId = Type.String({ minLength: 1, maxLength: 64, description: "Id of the run" });

const attachment = Type.Object({
  name: Type.String({ minLength: 1 }),
  mediaType: Type.String({ minLength: 1 }),
  data: Type.String({ description: "Content as Base64" }),
}, { additionalProperties: false });

const listedSession = openJson<ListedSession>("ListedSession");

const shareAccess = Type.Union([Type.Literal("read"), Type.Literal("write")], {
  description: "read sees the run and operates nothing; write also operates it as far as the user's own rights go",
});

const runSharing = Type.Object({
  everyone: Type.Union([shareAccess, Type.Null()], { description: "Access of every user of the profile; null for none" }),
  users: Type.Array(Type.Object({
    userId: Type.String({ minLength: 1, description: "Id of a user of the profile, never the run's owner" }),
    access: shareAccess,
  }, { additionalProperties: false }), { description: "Individual users with their own access; a user gets the higher of everyone's and their own" }),
}, { additionalProperties: false });

const runSharingResult = Type.Object({
  sharing: Type.Object({
    everyone: Type.Union([shareAccess, Type.Null()]),
    users: Type.Array(Type.Object({
      userId: Type.String(),
      label: Type.String({ description: "Display name; the id for a user the profile no longer has" }),
      access: shareAccess,
    }, { additionalProperties: false })),
  }, { additionalProperties: false }),
  users: Type.Array(Type.Object({ id: Type.String(), label: Type.String() }, { additionalProperties: false }), {
    description: "The users of the profile the run can be shared with, without its owner",
  }),
}, { additionalProperties: false });

/** Whom a run is shared with, as ragents.runs.sharing and ragents.runs.share return it. */
export type RunSharingResult = Static<typeof runSharingResult>;

/** The retained installed host tarball available to workstation users. */
export interface HostPackageDownload {
  readonly path: string;
  readonly integrity: string;
}

/** The plugins' profile, server version, extension interface number and optional workstation host download. */
export type HostBootstrap = PublicPluginProfile & { readonly version: string; readonly extensionApi: number; readonly hostPackage: HostPackageDownload | null };

const chatContextUsage = Type.Object({
  tokens: Type.Integer({ minimum: 0 }),
  contextWindow: Type.Integer({ minimum: 1 }),
  compactionThreshold: Type.Integer({ minimum: 1 }),
  estimated: Type.Boolean(),
}, { additionalProperties: false });

export type ChatContextUsage = Static<typeof chatContextUsage>;

export const coreContracts = {
  runs: {
    list: defineOperation({
      id: "ragents.runs.list",
      description: "All runs of the profile the caller sees, its own and those shared with it, with title, times, state (paused, running, waiting, idle, ended), pending actions, the caller's own seenRevision, whether the caller operates it (operable), its sharing for the caller (canShare and shared for whoever may change it, sharedAccess for whoever sees it only through a share), metadata and its list lines. Right: runs.read.",
      rights: ["runs.read"],
      input: Type.Object({}, { additionalProperties: false }),
      result: Type.Array(listedSession),
    }),
    markViewed: defineOperation({
      id: "ragents.runs.markViewed",
      description: "Record that the caller has viewed a run up to this revision; ragents.runs.list reports it back to the same user as seenRevision, on every device and host, and to nobody else. Only a higher revision counts. Right: runs.read.",
      rights: ["runs.read"],
      input: Type.Object({ runId, revision: Type.Integer({ minimum: 0, description: "The viewed journal revision of the run" }) }, { additionalProperties: false }),
      result: Type.Null(),
    }),
    delete: defineOperation({
      id: "ragents.runs.delete",
      description: "Delete a run with its data; a user who sees the run only through a share never deletes it (run-delete-denied). Rights: runs.read and runs.delete.",
      rights: ["runs.read", "runs.delete"],
      input: Type.Object({ runId }, { additionalProperties: false }),
      result: Type.Null(),
    }),
    sharing: defineOperation({
      id: "ragents.runs.sharing",
      description: "Whom a run is shared with, each with its access, and the users of the profile it can be shared with. Before the start, the caller's own choice for the run it is about to create. Only with sign-in (sharing-unavailable), not for a global coordinator or a run without an owner (run-not-shareable). Rights: runs.read and runs.write, and the caller must own the run or have runs.read.all (run-sharing-denied).",
      input: Type.Object({ runId }, { additionalProperties: false }),
      result: runSharingResult,
    }),
    share: defineOperation({
      id: "ragents.runs.share",
      description: "Replace whom a run is shared with: every user of the profile (everyone) and individual users, each with read (sees the run, operates nothing) or write (operates it as far as the user's own rights go); a user gets the higher of both. Before the start the choice waits for the run's creation by the caller, afterwards it is written to the journal; an unchanged sharing writes nothing. A user unknown to the profile (share-user-unknown), the owner (share-owner) and a user named twice (share-user-duplicate) are refused. Result as ragents.runs.sharing. Rights as for ragents.runs.sharing.",
      input: Type.Object({ runId, sharing: runSharing }, { additionalProperties: false }),
      result: runSharingResult,
    }),
    scripts: defineOperation({
      id: "ragents.runs.scripts",
      description: "The run scripts the caller may start, and for a running run whether each can start there now: available, otherwise reason (not embeddable, a fixed start option differs from the run's). Rights: runs.read, runs.write.",
      input: Type.Object({ runId }, { additionalProperties: false }),
      result: Type.Array(Type.Object({
        id: Type.String(),
        title: Type.String(),
        description: Type.String(),
        available: Type.Boolean(),
        reason: Type.Optional(Type.String()),
      }, { additionalProperties: false })),
    }),
    startScript: defineOperation({
      id: "ragents.runs.startScript",
      timeoutMs: 75 * 60_000,
      description: "Start a run script and wait until its actor has the start input; errors come back to the caller instead of the chat. A new run starts as with ragents.chat.start. In a running run only a script whose RUN.md sets embeddable: true starts, its fixed start options must match the run's, and the primary actor stays. Every start opens a new room named after the script with its own actors. Result: the script actor, its address (room.handle), and which start of its package this was. Rights: runs.read, runs.write and the template's release.",
      input: Type.Object({ runId, entry: Type.String({ minLength: 1 }), input: Type.Optional(Type.Any()) }, { additionalProperties: false }),
      result: Type.Object({ actorId: Type.String(), handle: Type.String(), count: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
    }),
  },
  chat: {
    send: defineOperation({
      id: "ragents.chat.send",
      timeoutMs: 75 * 60_000,
      description: "A message to the run's coordinator; starts a new run or cuts into a running one. With entry, it starts the run through this skill template and the start options it fixes. Rights: runs.read and runs.write, for a new run runs.create; for the global chat its rights.",
      input: Type.Object({
        runId,
        text: Type.Optional(Type.String()),
        attachments: Type.Optional(Type.Array(attachment)),
        userLocation: Type.Optional(openJson<ChatUserLocation>("ChatUserLocation")),
        entry: Type.Optional(Type.String({ minLength: 1, description: "Id of the skill template through which this message starts the run" })),
      }, { additionalProperties: false }),
      result: Type.Null(),
    }),
    sendToActor: defineOperation({
      id: "ragents.chat.sendToActor",
      timeoutMs: 75 * 60_000,
      description: "A message to a specific LLM actor of the run. Rights as for ragents.chat.send.",
      input: Type.Object({ runId, actorId: Type.String({ minLength: 1 }), text: Type.Optional(Type.String()), attachments: Type.Optional(Type.Array(attachment)) }, { additionalProperties: false }),
      result: Type.Null(),
    }),
    start: defineOperation({
      id: "ragents.chat.start",
      description: "Start a run through a script template, without a message; the start options the template fixes apply. Returns once the start is accepted; progress and errors appear in the chat. In a running run it starts an embeddable script like ragents.runs.startScript. Rights: runs.read, runs.write and the template's release.",
      input: Type.Object({ runId, entry: Type.String({ minLength: 1 }), input: Type.Optional(Type.Any()) }, { additionalProperties: false }),
      result: Type.Null(),
    }),
    stop: defineOperation({
      id: "ragents.chat.stop",
      description: "Emergency stop for the whole run: aborts all turns and a running start and stops all actors. ragents.runs.interruptTurn interrupts a single turn. Rights: runs.read and runs.write.",
      input: Type.Object({ runId }, { additionalProperties: false }),
      result: Type.Null(),
    }),
    capabilities: defineOperation({
      id: "ragents.chat.capabilities",
      description: "Which attachments an actor's model accepts; the model name appears only with runs.inspect. Right: runs.read.",
      input: Type.Object({ runId, actor: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: false }),
      result: openJson<ChatAttachmentCapabilities>("ChatAttachmentCapabilities"),
    }),
    contextUsage: defineOperation({
      id: "ragents.chat.contextUsage",
      description: "The actor's active context token count, whether it is estimated, and the window and compaction threshold of its selected model. Limits apply from the next turn. Null for a runtime without a built-in model context. Right: runs.read.",
      input: Type.Object({ runId, actor: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: false }),
      result: Type.Union([chatContextUsage, Type.Null()]),
    }),
    actorHistory: defineOperation({
      id: "ragents.chat.actorHistory",
      description: "The conversation histories of all actors of the run, without runs.inspect without tool details. Right: runs.read.",
      input: Type.Object({ runId }, { additionalProperties: false }),
      result: openJson<ActorConversations>("ActorConversations"),
    }),
  },
  startOptions: {
    list: defineOperation({
      id: "ragents.startOptions.list",
      description: "The start options of a run with value and presentation, only those whose own rights the caller has; the model choice, for example, requires runs.inspect. After the start, all except the changeable ones are locked. Rights: runs.read, runs.create.",
      rights: ["runs.read", "runs.create"],
      input: Type.Object({ runId }, { additionalProperties: false }),
      result: Type.Array(openJson<StartOptionState>("StartOptionState")),
    }),
    select: defineOperation({
      id: "ragents.startOptions.select",
      description: "Choose a start option before the start, a changeable one such as the model choice also afterwards, taking effect from the next turn; if a right of the option itself is missing, the choice fails with access-denied. Rights: runs.read, runs.write, runs.create.",
      rights: ["runs.read", "runs.write", "runs.create"],
      input: Type.Object({ runId, optionId: Type.String({ minLength: 1, maxLength: 128 }), value: Type.Any() }, { additionalProperties: false }),
      result: openJson<StartOptionState>("StartOptionState"),
    }),
  },
  transfer: {
    export: defineOperation({
      id: "ragents.runs.export",
      description: "Fetch a stopped run as an archive: journal, payloads, model contexts and its plugin stores. Rights: runs.read and runs.inspect.",
      rights: ["runs.read", "runs.inspect"],
      input: Type.Object({ runId }, { additionalProperties: false }),
      result: openJson<RunTransferExport>("RunTransferExport"),
    }),
    import: defineOperation({
      id: "ragents.runs.import",
      description: "Accept a run archive, replay its journal and open the run stopped. Requires administrator access (*).",
      rights: ["*"],
      input: Type.Object({
        archive: Type.String({ minLength: 1, description: "The export's tar.gz as Base64" }),
        workspacePath: Type.Optional(Type.String({ minLength: 1, description: "Replacement folder on this server for a run with binding path" })),
      }, { additionalProperties: false }),
      result: openJson<RunTransferImport>("RunTransferImport"),
    }),
  },
  prepare: defineOperation({
    id: "ragents.runs.prepare",
    timeoutMs: 125_000,
    description: "Work out the task of a new run in a conversation with a separate coordinator instance. Rights: runs.read, runs.write, runs.create.",
    rights: ["runs.read", "runs.write", "runs.create"],
    input: Type.Intersect([Type.Object({ runId }), openJson<RunPreparationRequest>("RunPreparationRequest")]),
    result: openJson<RunPreparationResponse>("RunPreparationResponse"),
  }),
  settings: {
    read: defineOperation({
      id: "ragents.settings.read",
      description: "Models, plugins, tools, skills and runtime information of the profile. Right: settings.read; only locally or with access.",
      rights: ["settings.read"],
      input: Type.Object({}, { additionalProperties: false }),
      result: openJson<SettingsResponse>("SettingsResponse"),
    }),
    skill: defineOperation({
      id: "ragents.settings.skill",
      description: "Read the files of a registered skill; null if it is not registered. Right: settings.read.",
      rights: ["settings.read"],
      input: Type.Object({ id: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
      result: Type.Union([openJson<SettingsSkillDetail>("SettingsSkillDetail"), Type.Null()]),
    }),
    titlesRead: defineOperation({
      id: "ragents.settings.titles.read",
      description: "Read the model for automatic titles and the choices. Right: settings.read.",
      rights: ["settings.read"],
      input: Type.Object({}, { additionalProperties: false }),
      result: openJson<TitleModelSettings>("TitleModelSettings"),
    }),
    titlesSave: defineOperation({
      id: "ragents.settings.titles.save",
      description: "Set the model for automatic titles or turn their generation off. Right: settings.write.",
      rights: ["settings.write"],
      input: Type.Object({ value: Type.Any() }, { additionalProperties: false }),
      result: openJson<TitleModelSettings>("TitleModelSettings"),
    }),
  },
  plugins: {
    bootstrap: defineOperation({
      id: "ragents.plugins.bootstrap",
      description: "Product, active plugins with web configuration, released templates, the server's RAgents version for the UI and the number of its interface to the VS Code extension.",
      input: Type.Object({}, { additionalProperties: false }),
      result: openJson<HostBootstrap>("HostBootstrap"),
    }),
  },
  external: {
    set: defineOperation({
      id: "ragents.external.set",
      description: "Turn external access on or off; only from the local machine. Right: settings.write.",
      rights: ["settings.write"],
      input: Type.Object({ state: Type.Union([Type.Literal("on"), Type.Literal("off")]) }, { additionalProperties: false }),
      result: Type.Object({ external: Type.Boolean() }),
    }),
  },
  channels: {
    runs: defineChannel({
      id: "ragents.runs",
      description: "Reports every change of the run list, also when a run is shared with the caller or no longer, a changed read marker only to its user. Right: runs.read.",
      rights: ["runs.read"],
      params: Type.Object({}, { additionalProperties: false }),
      message: Type.Object({ type: Type.Literal("changed") }),
    }),
    run: defineChannel({
      id: "ragents.run",
      description: "Reports every new journal event of a run; first ready, then run. Rights as for reading the run; it ends as soon as the caller no longer sees the run because a share was taken back.",
      params: Type.Object({ runId }, { additionalProperties: false }),
      message: Type.Object({ kind: Type.Union([Type.Literal("ready"), Type.Literal("run")]) }),
    }),
    chat: defineChannel({
      id: "ragents.chat",
      description: "The coordinator's chat history: first the stored history, then live. Rights as for reading the run; it ends as soon as the caller no longer sees the run because a share was taken back.",
      params: Type.Object({ runId }, { additionalProperties: false }),
      message: openJson<ChatEvent>("ChatEvent"),
    }),
  },
} as const;

export const ATTACHMENT_CONTENT_PATH = /^\/files\/runs\/([A-Za-z0-9_-]{1,64})\/attachments\/([A-Za-z0-9_-]{1,128})$/;

export const attachmentContentPath = (runId: string, artifactId: string): string =>
  `/files/runs/${encodeURIComponent(runId)}/attachments/${encodeURIComponent(artifactId)}`;
