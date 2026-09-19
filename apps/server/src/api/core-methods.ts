import { canStartEntry, DomainError, implement, implementChannel, type AccessContext, type ChannelContribution, type MethodContribution, type PluginHost } from "@aicontainer/ragents";
import { parseChatAttachments } from "../chat-attachments.js";
import type { ChatSessionLike, ChatSessionProvider, ChatUser } from "../chat-handler.js";
import { accessibleActorConversations, accessibleChatEvent } from "../access-projection.js";
import type { StartOptionState } from "../plugin-support/start-options-contract.js";
import type { RunPreparationResponse } from "../run-preparation-contract.js";
import type { SettingsResponse, SettingsSkillDetail } from "../settings.js";
import type { TitleModelSettings } from "../title-settings-contract.js";
import { coreContracts } from "./contracts.js";
import { assertRunRights, type GlobalRunPolicy } from "./rights.js";
import { assertRights } from "../rpc/dispatcher.js";

export interface CoreMethodSources {
  sessions: ChatSessionProvider & {
    subscribeList: (listener: () => void) => () => void;
    subscribeRun: (runId: string, listener: () => void) => () => void;
    startOptions: (runId: string) => readonly StartOptionState[];
    selectStartOption: (runId: string, optionId: string, value: unknown) => StartOptionState;
    prepareRunMessage: (runId: string, request: unknown, signal: AbortSignal) => Promise<RunPreparationResponse>;
    settings: () => Promise<SettingsResponse>;
    skill: (id: string) => Promise<SettingsSkillDetail | null>;
    titleModelSettings: () => TitleModelSettings;
    saveTitleModelSettings: (value: unknown) => Promise<TitleModelSettings>;
  };
  plugins: PluginHost;
  global: GlobalRunPolicy | undefined;
  /** Einstellungen sind ohne Anmeldung und Zugangstoken nur vom eigenen Rechner lesbar. */
  settingsGuarded: () => boolean;
  external: { open: () => boolean; set: (value: boolean) => Promise<void> };
}

const userOf = (access: AccessContext): ChatUser | undefined => access.user ? { id: access.user.id, label: access.user.label } : undefined;

const messageOf = (text: string | undefined, attachments: unknown) => {
  try {
    const trimmed = text?.trim() ?? "";
    const parsed = parseChatAttachments(attachments);
    if (!trimmed && parsed.length === 0) throw new Error("Text oder Anhänge fehlen");
    return { text: trimmed, attachments: parsed };
  } catch (error) {
    throw new DomainError("invalid-message", error instanceof Error ? error.message : String(error), 400);
  }
};

const TECHNICAL_ATTACHMENT_ERRORS = ["attachment-model-unsupported", "attachment-tools-required", "attachments-unsupported"];

/** Ohne runs.inspect bekommt der Benutzer bei technischen Fehlern nur den allgemeinen Hinweis, wie bisher. */
const guardedForUser = async <T>(access: AccessContext, work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (access.can("runs.inspect")) throw error;
    const technical = error instanceof DomainError && TECHNICAL_ATTACHMENT_ERRORS.includes(error.code);
    if (technical) throw new DomainError(error.code, "Dieser Agent kann die angehängte Datei nicht verarbeiten.", error.status);
    if (!(error instanceof DomainError) || error.status >= 500) throw new DomainError("request-failed", "Die Anfrage konnte nicht verarbeitet werden.", 500);
    throw error;
  }
};

export const coreMethods = (sources: CoreMethodSources): MethodContribution[] => {
  const { sessions, global } = sources;
  const session = async (access: AccessContext, runId: string, kind: "read" | "write"): Promise<ChatSessionLike> => {
    assertRunRights(access, runId, kind, global);
    return sessions.get(runId);
  };
  const assertMaySend = (access: AccessContext, runId: string) => {
    if (!access.can("runs.create") && !sessions.hasRun?.(runId)) throw new DomainError("access-denied", "Freie Runs sind für diesen Zugang nicht freigegeben.", 403);
  };
  const assertSettingsReachable = (local: boolean) => {
    if (!local && sources.settingsGuarded()) throw new DomainError("settings-local-only", "Einstellungen sind nur lokal oder mit Zugangstoken verfügbar", 403);
  };
  return [
    implement(coreContracts.sessions.list, () => sessions.list()),
    implement(coreContracts.sessions.delete, async ({ runId }) => { await sessions.delete(runId); return null; }),
    implement(coreContracts.chat.send, async ({ runId, text, attachments, userLocation }, { access }) => {
      assertMaySend(access, runId);
      const current = await session(access, runId, "write");
      const message = messageOf(text, attachments);
      await guardedForUser(access, async () => current.send(message.text, message.attachments, userLocation, userOf(access)));
      return null;
    }),
    implement(coreContracts.chat.sendToActor, async ({ runId, actorId, text, attachments }, { access }) => {
      assertMaySend(access, runId);
      const current = await session(access, runId, "write");
      if (!current.sendToActor) throw new DomainError("actor-send-unavailable", "Actor-Nachrichten sind nicht verfügbar", 404);
      const message = messageOf(text, attachments);
      await guardedForUser(access, () => current.sendToActor!(actorId, message.text, message.attachments));
      return null;
    }),
    implement(coreContracts.chat.start, async ({ runId, entry, input }, { access }) => {
      const trimmed = entry.trim();
      if (!canStartEntry(access, trimmed)) throw new DomainError("access-denied", "Dieses Setup ist für diesen Zugang nicht freigegeben.", 403);
      const current = await session(access, runId, "write");
      current.start(trimmed, input === undefined ? null : input, userOf(access));
      return null;
    }),
    implement(coreContracts.chat.stop, async ({ runId }, { access }) => {
      const current = await session(access, runId, "write");
      await current.stop();
      return null;
    }),
    implement(coreContracts.chat.capabilities, async ({ runId, actor }, { access }) => {
      const current = await session(access, runId, "read");
      if (!current.capabilities) throw new DomainError("capabilities-unavailable", "Modellfähigkeiten sind nicht verfügbar", 404);
      const capabilities = await current.capabilities(actor ?? "primary");
      return access.can("runs.inspect") ? capabilities : { ...capabilities, model: "" };
    }),
    implement(coreContracts.chat.actorHistory, async ({ runId }, { access }) => {
      const current = await session(access, runId, "read");
      if (!current.actorConversations) throw new DomainError("actor-history-unavailable", "Actor-Verläufe sind nicht verfügbar", 404);
      return accessibleActorConversations(current.actorConversations(), access);
    }),
    implement(coreContracts.startOptions.list, ({ runId }) => [...sessions.startOptions(runId)]),
    implement(coreContracts.startOptions.select, ({ runId, optionId, value }) => sessions.selectStartOption(runId, optionId, value)),
    implement(coreContracts.prepare, ({ runId, ...request }, { signal }) => sessions.prepareRunMessage(runId, request, signal)),
    implement(coreContracts.settings.read, (_input, { local }) => { assertSettingsReachable(local); return sessions.settings(); }),
    implement(coreContracts.settings.skill, ({ id }, { local }) => { assertSettingsReachable(local); return sessions.skill(id); }),
    implement(coreContracts.settings.titlesRead, (_input, { local }) => { assertSettingsReachable(local); return sessions.titleModelSettings(); }),
    implement(coreContracts.settings.titlesSave, ({ value }, { local }) => { assertSettingsReachable(local); return sessions.saveTitleModelSettings(value); }),
    implement(coreContracts.plugins.bootstrap, (_input, { access }) => sources.plugins.publicProfile(access)),
    implement(coreContracts.external.set, async ({ state }, { local }) => {
      if (!local) throw new DomainError("local-only", "Nur lokal schaltbar", 403);
      await sources.external.set(state === "on");
      return { external: sources.external.open() };
    }),
  ];
};

export const coreChannels = (sources: Pick<CoreMethodSources, "sessions" | "global">): ChannelContribution[] => {
  const { sessions, global } = sources;
  return [
    implementChannel(coreContracts.channels.sessions, (_params, emit) => {
      const notify = () => emit({ type: "changed" });
      const unsubscribe = sessions.subscribeList(notify);
      notify();
      return unsubscribe;
    }),
    implementChannel(coreContracts.channels.run, ({ runId }, emit, { access }) => {
      assertRunRights(access, runId, "read", global);
      emit({ kind: "ready" });
      return sessions.subscribeRun(runId, () => emit({ kind: "run" }));
    }),
    implementChannel(coreContracts.channels.chat, async ({ runId }, emit, { access }) => {
      assertRunRights(access, runId, "read", global);
      const current = await sessions.get(runId);
      return current.subscribe((event) => {
        const visible = accessibleChatEvent(event, access);
        if (visible) emit(visible);
      });
    }),
  ];
};

export { assertRights };
