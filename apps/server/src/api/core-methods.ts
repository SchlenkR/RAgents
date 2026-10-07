import { canStartEntry, DomainError, hasWorkstationOwner, implement, implementChannel, type AccessContext, type ChannelContribution, type MethodContribution, type PluginHost, type RunSharing } from "@ragents/engine";
import { parseChatAttachments } from "quassel/events";
import type { ChatSessionLike, ChatSessionProvider, ChatUser } from "../chat-handler.js";
import { accessibleActorConversations, accessibleChatEvent } from "../access-projection.js";
import type { StartOptionState } from "../plugin-support/start-options-contract.js";
import type { RunPreparationResponse } from "../run-preparation-contract.js";
import type { RunTransferExport, RunTransferImport } from "../run-transfer.js";
import type { SettingsResponse, SettingsSkillDetail } from "../settings.js";
import type { TitleModelSettings } from "../title-settings-contract.js";
import { EXTENSION_API_VERSION } from "../extension-api.js";
import { coreContracts, type HostPackageDownload, type RunSharingResult } from "./contracts.js";
import { assertRunDeletable, assertRunReachable, assertRunRights, runListScope, runSharer, type GlobalRunPolicy, type RunAccessPolicy } from "./rights.js";

export interface CoreMethodSources {
  sessions: ChatSessionProvider & {
    subscribeList: (listener: () => void, userId: string | null) => () => void;
    markViewed: (runId: string, revision: number, userId: string | null) => void;
    /** Whom the run is shared with for this user, who may change it; before the start their own choice. */
    sharing: (runId: string, userId: string) => RunSharingResult;
    /** Replaces the sharing for this user, who may change it; before the start it waits for the run's creation. */
    share: (runId: string, sharing: RunSharing, userId: string) => RunSharingResult;
    subscribeRun: (runId: string, listener: () => void) => () => void;
    startOptions: (runId: string, userId: string | null) => readonly StartOptionState[];
    selectStartOption: (runId: string, optionId: string, value: unknown, userId: string | null) => Promise<StartOptionState>;
    prepareRunMessage: (runId: string, request: unknown, signal: AbortSignal, userId: string | null) => Promise<RunPreparationResponse>;
    exportRun: (runId: string) => Promise<RunTransferExport>;
    importRun: (archive: Buffer, workspacePath: string | undefined) => Promise<RunTransferImport>;
    settings: () => Promise<SettingsResponse>;
    skill: (id: string) => Promise<SettingsSkillDetail | null>;
    titleModelSettings: () => TitleModelSettings;
    saveTitleModelSettings: (value: unknown) => Promise<TitleModelSettings>;
  };
  plugins: PluginHost;
  /** The RAgents version of this server; a UI with a different version shows the difference. */
  version: string;
  hostPackage?: HostPackageDownload;
  global: GlobalRunPolicy | undefined;
  /** The user of a run: null without an owner, undefined for an id without a run. */
  runOwner: (runId: string) => string | null | undefined;
  /** Whether only the owner operates the run. */
  runOwnerOnly: (runId: string) => boolean;
  /** Whom the run is shared with besides its owner. */
  runSharing: (runId: string) => RunSharing;
  /** Without sign-in and access token, settings are readable only from the local machine. */
  settingsGuarded: () => boolean;
  external: { open: () => boolean; set: (value: boolean) => Promise<void> };
}

const policyOf = (sources: Pick<CoreMethodSources, "global" | "runOwner" | "runOwnerOnly" | "runSharing">): RunAccessPolicy =>
  ({ global: sources.global, ownerOf: sources.runOwner, ownerOnly: sources.runOwnerOnly, sharing: sources.runSharing });

const userOf = (access: AccessContext): ChatUser | undefined => access.user ? { id: access.user.id, label: access.user.label } : undefined;

const userIdOf = (access: AccessContext): string | null => access.user?.id ?? null;

/** The UI context names the run open when sending; it too is an access to that run. */
const locatedRun = (userLocation: unknown): string | undefined => {
  const named = typeof userLocation === "object" && userLocation !== null && "runId" in userLocation
    ? (userLocation as { runId: unknown }).runId : undefined;
  return typeof named === "string" ? named : undefined;
};

const messageOf = (text: string | undefined, attachments: unknown) => {
  try {
    const trimmed = text?.trim() ?? "";
    const parsed = parseChatAttachments(attachments);
    if (!trimmed && parsed.length === 0) throw new Error("Text or attachments are missing");
    return { text: trimmed, attachments: parsed };
  } catch (error) {
    throw new DomainError("invalid-message", error instanceof Error ? error.message : String(error), 400);
  }
};

const TECHNICAL_ATTACHMENT_ERRORS = ["attachment-model-unsupported", "attachment-tools-required", "attachments-unsupported"];

/** Without runs.inspect, the user gets only the general notice on technical errors, as before. */
const guardedForUser = async <T>(access: AccessContext, work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (access.can("runs.inspect")) throw error;
    const technical = error instanceof DomainError && TECHNICAL_ATTACHMENT_ERRORS.includes(error.code);
    if (technical) throw new DomainError(error.code, "This agent cannot process the attached file.", error.status);
    if (!(error instanceof DomainError) || error.status >= 500) throw new DomainError("request-failed", "The request could not be processed.", 500);
    throw error;
  }
};

export const coreMethods = (sources: CoreMethodSources): MethodContribution[] => {
  const { sessions, global } = sources;
  const policy = policyOf(sources);
  const session = async (access: AccessContext, runId: string, kind: "read" | "write" | "stop"): Promise<ChatSessionLike> => {
    assertRunRights(access, runId, kind, policy);
    return sessions.get(runId);
  };
  const assertMaySend = (access: AccessContext, runId: string) => {
    if (!access.can("runs.create") && !sessions.hasRun?.(runId) && !global?.isCoordinator(runId)) throw new DomainError("access-denied", "Free runs are not enabled for this access.", 403);
  };
  const assertSettingsReachable = (local: boolean) => {
    if (!local && sources.settingsGuarded()) throw new DomainError("settings-local-only", "Settings are only available locally or with an access token", 403);
  };
  return [
    implement(coreContracts.runs.list, (_input, { access }) => sessions.list(runListScope(access, policy))),
    implement(coreContracts.runs.delete, async ({ runId }, { access }) => {
      assertRunDeletable(access, runId, policy);
      await sessions.delete(runId);
      return null;
    }),
    implement(coreContracts.runs.sharing, ({ runId }, { access }) => sessions.sharing(runId, runSharer(access, runId, policy))),
    implement(coreContracts.runs.share, ({ runId, sharing }, { access }) => sessions.share(runId, sharing, runSharer(access, runId, policy))),
    implement(coreContracts.runs.markViewed, ({ runId, revision }, { access }) => {
      assertRunRights(access, runId, "read", policy);
      sessions.markViewed(runId, revision, userIdOf(access));
      return null;
    }),
    implement(coreContracts.chat.send, async ({ runId, text, attachments, userLocation, entry }, { access, signal }) => {
      assertMaySend(access, runId);
      const located = locatedRun(userLocation);
      if (located !== undefined) assertRunReachable(access, located, policy);
      const current = await session(access, runId, "write");
      const message = messageOf(text, attachments);
      await guardedForUser(access, async () => current.send(message.text, message.attachments, userLocation, userOf(access), entry, signal));
      return null;
    }),
    implement(coreContracts.chat.sendToActor, async ({ runId, actorId, text, attachments }, { access, signal }) => {
      assertMaySend(access, runId);
      const current = await session(access, runId, "write");
      if (!current.sendToActor) throw new DomainError("actor-send-unavailable", "Actor messages are not available", 404);
      const message = messageOf(text, attachments);
      await guardedForUser(access, () => current.sendToActor!(actorId, message.text, message.attachments, userOf(access), signal));
      return null;
    }),
    implement(coreContracts.chat.start, async ({ runId, entry, input }, { access }) => {
      const trimmed = entry.trim();
      if (!canStartEntry(access, trimmed)) throw new DomainError("access-denied", "This setup is not enabled for this access.", 403);
      const current = await session(access, runId, "write");
      current.start(trimmed, input === undefined ? null : input, userOf(access));
      return null;
    }),
    implement(coreContracts.runs.scripts, async ({ runId }, { access }) => {
      const current = await session(access, runId, "write");
      if (!current.runScripts) throw new DomainError("script-start-unavailable", "This run cannot start run scripts.", 404);
      return current.runScripts(sources.plugins.startEntries.describe().filter((entry) => canStartEntry(access, entry.id)), userIdOf(access));
    }),
    implement(coreContracts.runs.startScript, async ({ runId, entry, input }, { access, signal }) => {
      const trimmed = entry.trim();
      if (!canStartEntry(access, trimmed)) throw new DomainError("access-denied", "This setup is not enabled for this access.", 403);
      const current = await session(access, runId, "write");
      if (!current.startAndWait) throw new DomainError("script-start-unavailable", "This run cannot start run scripts.", 404);
      return current.startAndWait(trimmed, input === undefined ? null : input, userOf(access), undefined, signal);
    }),
    implement(coreContracts.chat.stop, async ({ runId }, { access }) => {
      const current = await session(access, runId, "stop");
      await current.stop();
      return null;
    }),
    implement(coreContracts.chat.capabilities, async ({ runId, actor }, { access }) => {
      const current = await session(access, runId, "read");
      if (!current.capabilities) throw new DomainError("capabilities-unavailable", "Model capabilities are not available", 404);
      const capabilities = await current.capabilities(actor ?? "primary", userIdOf(access));
      return access.can("runs.inspect") ? capabilities : { ...capabilities, model: "" };
    }),
    implement(coreContracts.chat.actorHistory, async ({ runId }, { access }) => {
      const current = await session(access, runId, "read");
      if (!current.actorConversations) throw new DomainError("actor-history-unavailable", "Actor histories are not available", 404);
      return accessibleActorConversations(current.actorConversations(), access);
    }),
    implement(coreContracts.startOptions.list, ({ runId }, { access }) =>
      sessions.startOptions(runId, userIdOf(access)).filter((option) => sources.plugins.startOptions.missingRight(option.id, access) === undefined)),
    implement(coreContracts.startOptions.select, ({ runId, optionId, value }, { access }) => {
      sources.plugins.startOptions.assertRights(optionId, access);
      return sessions.selectStartOption(runId, optionId, value, userIdOf(access));
    }),
    implement(coreContracts.prepare, ({ runId, ...request }, { signal, access }) =>
      sessions.prepareRunMessage(runId, request, signal, userIdOf(access))),
    implement(coreContracts.transfer.export, ({ runId }) => sessions.exportRun(runId)),
    implement(coreContracts.transfer.import, ({ archive, workspacePath }) => {
      const decoded = Buffer.from(archive, "base64");
      if (decoded.length === 0) throw new DomainError("run-transfer-invalid", "The archive is empty.", 400);
      return sessions.importRun(decoded, workspacePath);
    }),
    implement(coreContracts.settings.read, (_input, { local }) => { assertSettingsReachable(local); return sessions.settings(); }),
    implement(coreContracts.settings.skill, ({ id }, { local }) => { assertSettingsReachable(local); return sessions.skill(id); }),
    implement(coreContracts.settings.titlesRead, (_input, { local }) => { assertSettingsReachable(local); return sessions.titleModelSettings(); }),
    implement(coreContracts.settings.titlesSave, ({ value }, { local }) => { assertSettingsReachable(local); return sessions.saveTitleModelSettings(value); }),
    implement(coreContracts.plugins.bootstrap, (_input, { access, local }) => ({
      ...sources.plugins.publicProfile(access), version: sources.version, extensionApi: EXTENSION_API_VERSION,
      hostPackage: access.can("runs.write") && hasWorkstationOwner(access, local) ? sources.hostPackage ?? null : null,
    })),
    implement(coreContracts.external.set, async ({ state }, { local }) => {
      if (!local) throw new DomainError("local-only", "Can only be switched locally", 403);
      await sources.external.set(state === "on");
      return { external: sources.external.open() };
    }),
  ];
};

export const coreChannels = (sources: Pick<CoreMethodSources, "sessions" | "plugins" | "global" | "runOwner" | "runOwnerOnly" | "runSharing">): ChannelContribution[] => {
  const { sessions } = sources;
  const policy = policyOf(sources);
  return [
    implementChannel(coreContracts.channels.runs, (_params, emit, { access }) => {
      const notify = () => emit({ type: "changed" });
      const unsubscribe = sessions.subscribeList(notify, userIdOf(access));
      notify();
      return unsubscribe;
    }),
    implementChannel(coreContracts.channels.run, ({ runId }, emit, { access }) => {
      assertRunRights(access, runId, "read", policy);
      emit({ kind: "ready" });
      return sessions.subscribeRun(runId, () => emit({ kind: "run" }));
    }),
    implementChannel(coreContracts.channels.chat, async ({ runId }, emit, { access }) => {
      assertRunRights(access, runId, "read", policy);
      const current = await sessions.get(runId);
      return current.subscribe((event) => {
        const visible = accessibleChatEvent(event, access, sources.plugins.accessProjections);
        if (visible) emit(visible);
      });
    }),
  ];
};
