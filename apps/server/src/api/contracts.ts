import { Type } from "typebox";
import type { PublicPluginProfile } from "@ragents/engine/src/plugin-types";
import { defineChannel, defineOperation } from "@ragents/engine/src/rpc/contract";
import { openJson, runContracts } from "@ragents/engine/src/http/contracts";
import type { ChatAttachmentCapabilities, ChatEvent } from "../chat-events.js";
import type { ChatUserLocation } from "../chat-context.js";
import type { SessionInfo } from "../chat-handler.js";
import type { ActorConversations } from "../ragents/actor-chat-history.js";
import type { StartOptionState } from "../plugin-support/start-options-contract.js";
import type { RunPreparationRequest, RunPreparationResponse } from "../run-preparation-contract.js";
import type { RunTransferExport, RunTransferImport } from "../run-transfer.js";
import type { SettingsResponse, SettingsSkillDetail } from "../settings.js";
import type { TitleModelSettings } from "../title-settings-contract.js";

export { runContracts };

const runId = Type.String({ minLength: 1, maxLength: 64, description: "Kennung des Runs" });

const attachment = Type.Object({
  name: Type.String({ minLength: 1 }),
  mediaType: Type.String({ minLength: 1 }),
  data: Type.String({ description: "Inhalt als Base64" }),
}, { additionalProperties: false });

const sessionInfo = openJson<SessionInfo>("SessionInfo");

/** Rechte je Run prüft der Host dynamisch; Verträge ohne `rights` nennen ihre Regel in der Beschreibung. */
export const coreContracts = {
  sessions: {
    list: defineOperation({
      id: "ragents.sessions.list",
      description: "Alle Runs des Profils mit Titel, Zeiten und Metadaten. Recht: runs.read.",
      rights: ["runs.read"],
      input: Type.Object({}, { additionalProperties: false }),
      result: Type.Array(sessionInfo),
    }),
    delete: defineOperation({
      id: "ragents.sessions.delete",
      description: "Einen Run mit seinen Daten löschen. Rechte: runs.read und runs.delete.",
      rights: ["runs.read", "runs.delete"],
      input: Type.Object({ runId }, { additionalProperties: false }),
      result: Type.Null(),
    }),
  },
  chat: {
    send: defineOperation({
      id: "ragents.chat.send",
      description: "Eine Nachricht an den Koordinator des Runs; startet einen neuen Run oder funkt in einen laufenden. Mit entry startet sie den Run über diesen Skill-Einstieg und dessen festgelegte Startoptionen. Rechte: runs.read und runs.write, für einen neuen Run runs.create; beim globalen Chat dessen Rechte.",
      input: Type.Object({
        runId,
        text: Type.Optional(Type.String()),
        attachments: Type.Optional(Type.Array(attachment)),
        userLocation: Type.Optional(openJson<ChatUserLocation>("ChatUserLocation")),
        entry: Type.Optional(Type.String({ minLength: 1, description: "Kennung des Skill-Einstiegs, über den diese Nachricht den Run startet" })),
      }, { additionalProperties: false }),
      result: Type.Null(),
    }),
    sendToActor: defineOperation({
      id: "ragents.chat.sendToActor",
      description: "Eine Nachricht an einen bestimmten LLM-Actor des Runs. Rechte wie ragents.chat.send.",
      input: Type.Object({ runId, actorId: Type.String({ minLength: 1 }), text: Type.Optional(Type.String()), attachments: Type.Optional(Type.Array(attachment)) }, { additionalProperties: false }),
      result: Type.Null(),
    }),
    start: defineOperation({
      id: "ragents.chat.start",
      description: "Einen Run über einen Run-Script-Einstieg starten, ohne Nachricht; die Startoptionen, die der Einstieg festlegt, gelten. Rechte: runs.read, runs.write und die Freigabe des Einstiegs.",
      input: Type.Object({ runId, entry: Type.String({ minLength: 1 }), input: Type.Optional(Type.Any()) }, { additionalProperties: false }),
      result: Type.Null(),
    }),
    stop: defineOperation({
      id: "ragents.chat.stop",
      description: "Not-Aus für den ganzen Run: bricht alle Turns und einen laufenden Start ab und stoppt alle Actors. Einen einzelnen Turn unterbricht ragents.runs.interruptTurn. Rechte: runs.read und runs.write.",
      input: Type.Object({ runId }, { additionalProperties: false }),
      result: Type.Null(),
    }),
    capabilities: defineOperation({
      id: "ragents.chat.capabilities",
      description: "Welche Anhänge das Modell eines Actors annimmt; der Modellname erscheint nur mit runs.inspect. Recht: runs.read.",
      input: Type.Object({ runId, actor: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: false }),
      result: openJson<ChatAttachmentCapabilities>("ChatAttachmentCapabilities"),
    }),
    actorHistory: defineOperation({
      id: "ragents.chat.actorHistory",
      description: "Die Gesprächsverläufe aller Actors des Runs, ohne runs.inspect ohne Werkzeugdetails. Recht: runs.read.",
      input: Type.Object({ runId }, { additionalProperties: false }),
      result: openJson<ActorConversations>("ActorConversations"),
    }),
  },
  startOptions: {
    list: defineOperation({
      id: "ragents.startOptions.list",
      description: "Die Startoptionen eines noch nicht gestarteten Runs mit Wert und Darstellung. Rechte: runs.read, runs.create, runs.inspect.",
      rights: ["runs.read", "runs.create", "runs.inspect"],
      input: Type.Object({ runId }, { additionalProperties: false }),
      result: Type.Array(openJson<StartOptionState>("StartOptionState")),
    }),
    select: defineOperation({
      id: "ragents.startOptions.select",
      description: "Eine Startoption vor dem Start wählen. Rechte: runs.read, runs.write, runs.create, runs.inspect.",
      rights: ["runs.read", "runs.write", "runs.create", "runs.inspect"],
      input: Type.Object({ runId, optionId: Type.String({ minLength: 1, maxLength: 128 }), value: Type.Any() }, { additionalProperties: false }),
      result: openJson<StartOptionState>("StartOptionState"),
    }),
  },
  transfer: {
    export: defineOperation({
      id: "ragents.runs.export",
      description: "Einen gestoppten Run als Archiv holen: Journal, Payloads, Modellkontexte und die Plugin-Ablagen seiner Session. Rechte: runs.read und runs.inspect.",
      rights: ["runs.read", "runs.inspect"],
      input: Type.Object({ runId }, { additionalProperties: false }),
      result: openJson<RunTransferExport>("RunTransferExport"),
    }),
    import: defineOperation({
      id: "ragents.runs.import",
      description: "Ein Run-Archiv annehmen, sein Journal wiedergeben und den Run gestoppt öffnen. Rechte: runs.read, runs.write und runs.create.",
      rights: ["runs.read", "runs.write", "runs.create"],
      input: Type.Object({
        archive: Type.String({ minLength: 1, description: "Das tar.gz des Exports als Base64" }),
        workspacePath: Type.Optional(Type.String({ minLength: 1, description: "Ersatzordner auf diesem Server für einen Run mit Bindung path" })),
      }, { additionalProperties: false }),
      result: openJson<RunTransferImport>("RunTransferImport"),
    }),
  },
  prepare: defineOperation({
    id: "ragents.runs.prepare",
    description: "Den Auftrag eines neuen Runs im Gespräch mit einer eigenen Koordinator-Instanz ausarbeiten. Rechte: runs.read, runs.write, runs.create.",
    rights: ["runs.read", "runs.write", "runs.create"],
    input: Type.Intersect([Type.Object({ runId }), openJson<RunPreparationRequest>("RunPreparationRequest")]),
    result: openJson<RunPreparationResponse>("RunPreparationResponse"),
  }),
  settings: {
    read: defineOperation({
      id: "ragents.settings.read",
      description: "Modelle, Plugins, Werkzeuge, Skills und Laufzeitinformationen des Profils. Recht: settings.read; nur lokal oder mit Zugang.",
      rights: ["settings.read"],
      input: Type.Object({}, { additionalProperties: false }),
      result: openJson<SettingsResponse>("SettingsResponse"),
    }),
    skill: defineOperation({
      id: "ragents.settings.skill",
      description: "Die Dateien eines registrierten Skills lesen; null, wenn er nicht registriert ist. Recht: settings.read.",
      rights: ["settings.read"],
      input: Type.Object({ id: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
      result: Type.Union([openJson<SettingsSkillDetail>("SettingsSkillDetail"), Type.Null()]),
    }),
    titlesRead: defineOperation({
      id: "ragents.settings.titles.read",
      description: "Das Modell für automatische Überschriften und die Auswahl lesen. Recht: settings.read.",
      rights: ["settings.read"],
      input: Type.Object({}, { additionalProperties: false }),
      result: openJson<TitleModelSettings>("TitleModelSettings"),
    }),
    titlesSave: defineOperation({
      id: "ragents.settings.titles.save",
      description: "Das Modell für automatische Überschriften setzen oder die Erzeugung ausschalten. Recht: settings.write.",
      rights: ["settings.write"],
      input: Type.Object({ value: Type.Any() }, { additionalProperties: false }),
      result: openJson<TitleModelSettings>("TitleModelSettings"),
    }),
  },
  plugins: {
    bootstrap: defineOperation({
      id: "ragents.plugins.bootstrap",
      description: "Produkt, aktive Plugins mit Web-Konfiguration und freigegebene Einstiege für die Oberfläche.",
      input: Type.Object({}, { additionalProperties: false }),
      result: openJson<PublicPluginProfile>("PublicPluginProfile"),
    }),
  },
  external: {
    set: defineOperation({
      id: "ragents.external.set",
      description: "Den Zugang von außen ein- oder ausschalten; nur vom eigenen Rechner. Recht: settings.write.",
      rights: ["settings.write"],
      input: Type.Object({ state: Type.Union([Type.Literal("on"), Type.Literal("off")]) }, { additionalProperties: false }),
      result: Type.Object({ external: Type.Boolean() }),
    }),
  },
  channels: {
    sessions: defineChannel({
      id: "ragents.sessions",
      description: "Meldet jede Änderung der Run-Liste. Recht: runs.read.",
      rights: ["runs.read"],
      params: Type.Object({}, { additionalProperties: false }),
      message: Type.Object({ type: Type.Literal("changed") }),
    }),
    run: defineChannel({
      id: "ragents.run",
      description: "Meldet jedes neue Journalereignis eines Runs; erst ready, dann run. Rechte wie das Lesen des Runs.",
      params: Type.Object({ runId }, { additionalProperties: false }),
      message: Type.Object({ kind: Type.Union([Type.Literal("ready"), Type.Literal("run")]) }),
    }),
    chat: defineChannel({
      id: "ragents.chat",
      description: "Der Chatverlauf des Koordinators: erst der gespeicherte Verlauf, dann live. Rechte wie das Lesen des Runs.",
      params: Type.Object({ runId }, { additionalProperties: false }),
      message: openJson<ChatEvent>("ChatEvent"),
    }),
  },
} as const;

export const ATTACHMENT_CONTENT_PATH = /^\/files\/runs\/([A-Za-z0-9_-]{1,64})\/attachments\/([A-Za-z0-9_-]{1,128})$/;

export const attachmentContentPath = (runId: string, artifactId: string): string =>
  `/files/runs/${encodeURIComponent(runId)}/attachments/${encodeURIComponent(artifactId)}`;
