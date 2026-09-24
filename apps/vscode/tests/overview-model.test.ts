import assert from "node:assert/strict";
import test from "node:test";
import { WORKSPACE_BINDING_OPTION_ID } from "../../../plugins/ragents.workspace/contract";
import { connectedCount, connectionView, newRunChoices, panelState, pendingActions, preselectable, resolveConnection } from "../src/overview-model";
import { runSummaryFrom } from "../src/run-model";
import type { ConnectionSnapshot, SessionStatus } from "../src/sessions";
import { runView, session } from "./fixtures";

const entries = [
  { id: "ragents.reference.board", title: "Sammelboard", description: "Ein Board für Ideen", action: "skill" as const, category: "Mini-Apps" },
  { id: "ragents.reference.circle", title: "Gesprächsrunde", description: "Vier Agenten im Kreis", action: "script" as const, category: "Run-Scripts" },
];

const snapshot = (overrides: Partial<ConnectionSnapshot> = {}): ConnectionSnapshot => ({
  connection: { kind: "server", name: "werkstatt", url: "http://localhost:4710" },
  status: { kind: "connected" } satisfies SessionStatus,
  url: "http://localhost:4710",
  localHost: false,
  runs: [runSummaryFrom(session(), runView())],
  entries,
  defaultEntry: undefined,
  user: undefined,
  canCreate: true,
  loginUser: undefined,
  savedLogin: false,
  problem: undefined,
  missingEnvironment: undefined,
  ...overrides,
});

const local = (overrides: Partial<ConnectionSnapshot> = {}): ConnectionSnapshot => snapshot({
  connection: { kind: "profile", name: "core", profileFile: "/x/ragents.config.core.ts" },
  status: { kind: "stopped" },
  url: undefined,
  runs: [],
  entries: [],
  canCreate: false,
  ...overrides,
});

test("die Übersicht führt Server und lokale Profile in einer Liste zusammen", () => {
  const state = panelState({ theme: "dark", page: "start", connections: [snapshot(), local()], profileSuggestions: ["/x/ragents.config.core.ts"], missingSecrets: [], problem: undefined, pickedProfileFile: undefined, runsConnection: undefined });
  assert.deepEqual(state.connections.map((entry) => [entry.name, entry.kind, entry.state.kind, entry.runs.length, entry.entries.length]), [
    ["werkstatt", "server", "connected", 1, 2],
    ["core", "profile", "stopped", 0, 0],
  ]);
  assert.equal(state.connections[0]?.address, "http://localhost:4710");
  assert.equal(state.connections[1]?.address, "/x/ragents.config.core.ts");
  assert.deepEqual(state.connections[0]?.entries, [
    { id: "ragents.reference.board", title: "Sammelboard", description: "Ein Board für Ideen", kind: "skill", category: "Mini-Apps" },
    { id: "ragents.reference.circle", title: "Gesprächsrunde", description: "Vier Agenten im Kreis", kind: "script", category: "Run-Scripts" },
  ]);
  assert.deepEqual(state.profileSuggestions, ["/x/ragents.config.core.ts"]);
  assert.deepEqual(state.connections[0]?.runs[0], { id: "run-a", title: "Nachtbus-Runde", state: "running", pendingActions: 1, updatedAt: 2 });
  assert.equal(state.page, "start");
  assert.equal(state.problem, undefined);
  assert.equal(state.runsConnection, undefined);
  assert.equal(panelState({ theme: "dark", page: "runs", connections: [], profileSuggestions: [], missingSecrets: [], problem: undefined, pickedProfileFile: undefined, runsConnection: "werkstatt" }).runsConnection, "werkstatt");
});

test("die Zielzeile kennt das lokale Profil, den Host des Servers und den Server, dessen Profil lokal läuft", () => {
  assert.deepEqual(connectionView(local()).route, { kind: "profile", profile: "core" });
  assert.deepEqual(connectionView(snapshot()).route, { kind: "server", host: "localhost:4710", localHost: false });
  assert.deepEqual(connectionView(snapshot({ connection: { kind: "server", name: "werkstatt", url: "https://workshop.example.com/" } })).route, { kind: "server", host: "workshop.example.com", localHost: false });
  assert.deepEqual(connectionView(snapshot({ connection: { kind: "server", name: "werkstatt", url: "https://workshop.example.com:8443" }, localHost: true })).route, { kind: "server", host: "workshop.example.com:8443", localHost: true });
});

test("jeder Zustand einer Sitzung wird zu einem Zustand der Karte, die Anmeldung nennt ihre Art", () => {
  const of = (status: SessionStatus) => connectionView(snapshot({ status })).state;
  assert.deepEqual(of({ kind: "starting", detail: "Host starten ..." }), { kind: "starting", detail: "Host starten ..." });
  assert.deepEqual(of({ kind: "starting", detail: undefined }), { kind: "starting" });
  assert.deepEqual(of({ kind: "failed", message: "kein Checkout" }), { kind: "failed", message: "kein Checkout" });
  assert.deepEqual(of({ kind: "login-required", tokenGate: true }), { kind: "login-required", mode: "token" });
  assert.deepEqual(of({ kind: "login-required", tokenGate: false }), { kind: "login-required", mode: "password" });
  assert.deepEqual(of({ kind: "unreachable", message: "ECONNREFUSED" }), { kind: "unreachable", message: "ECONNREFUSED" });
  assert.deepEqual(of({ kind: "forbidden", message: "Kein Zugriff" }), { kind: "forbidden", message: "Kein Zugriff" });
  assert.deepEqual(of({ kind: "connecting" }), { kind: "connecting" });
  const gescheitert = connectionView(snapshot({ problem: "Benutzerkennung oder Passwort stimmen nicht", loginUser: "alice", savedLogin: true, user: "Alice" }));
  assert.equal(gescheitert.problem, "Benutzerkennung oder Passwort stimmen nicht");
  assert.equal(gescheitert.loginUser, "alice");
  assert.equal(gescheitert.savedLogin, true);
  assert.equal(gescheitert.user, "Alice");
});

test("eine fehlende Umgebungsvariable steht als eigenes Feld in der Karte, ohne sie fehlt das Feld", () => {
  const missing = { variable: "SERVICE_TOKEN", section: "ragents.example", key: "SERVICE_KEY" };
  assert.deepEqual(connectionView(snapshot({ status: { kind: "failed", message: "endete mit Code 1" }, missingEnvironment: missing })).missingEnvironment, missing);
  assert.equal("missingEnvironment" in connectionView(snapshot()), false);
});

test("die Default-Vorlage des Servers steht als defaultEntry in der Karte, ohne ihn fehlt das Feld", () => {
  assert.equal(connectionView(snapshot({ defaultEntry: "ragents.reference.board" })).defaultEntry, "ragents.reference.board");
  assert.equal("defaultEntry" in connectionView(snapshot()), false);
});

test("eine Vorlage mit Leitfaden steht als geführt in der Karte, ohne ihn fehlt das Feld", () => {
  const guided = connectionView(snapshot({ entries: [{ ...entries[1]!, guide: "ragents.reference.circle-guide" }, entries[0]!] })).entries;
  assert.deepEqual(guided.map((entry) => [entry.id, entry.guided]), [["ragents.reference.circle", true], ["ragents.reference.board", undefined]]);
  assert.equal(Object.hasOwn(guided[1]!, "guided"), false);
});

test("ein Run, dessen Run-Ansicht nicht lesbar ist, trägt sein Problem in die Karte, sonst fehlt das Feld", () => {
  const broken = { ...runSummaryFrom(session({ id: "run-b" }), undefined), problem: "Die Run-Ansicht ist nicht lesbar: kaputt" };
  const runs = connectionView(snapshot({ runs: [runSummaryFrom(session(), runView()), broken] })).runs;
  assert.deepEqual(runs.map((run) => [run.id, run.problem]), [["run-a", undefined], ["run-b", "Die Run-Ansicht ist nicht lesbar: kaputt"]]);
  assert.equal(Object.hasOwn(runs[0]!, "problem"), false);
});

test("Zahlen der Statusleiste und des Abzeichens zählen über alle Server", () => {
  const snapshots = [snapshot(), snapshot({ connection: { kind: "server", name: "zweit", url: "http://localhost:4727" } }), local()];
  assert.equal(connectedCount(snapshots), 2);
  assert.equal(pendingActions(snapshots), 2);
});

test("Neuer Run bietet je verbundenem Server den freien Auftrag und seine Vorlagen an", () => {
  const groups = newRunChoices([snapshot(), local(), snapshot({ connection: { kind: "server", name: "ohne", url: "http://localhost:4711" }, canCreate: false })]);
  assert.deepEqual(groups.map((group) => group.group), ["werkstatt"]);
  assert.deepEqual(groups[0]?.choices.map((choice) => [choice.connection, choice.entryId, choice.title, choice.description]), [
    ["werkstatt", undefined, "Neuer Run", "ohne Vorlage"],
    ["werkstatt", "ragents.reference.board", "Sammelboard", "Skill"],
    ["werkstatt", "ragents.reference.circle", "Gesprächsrunde", "Run-Script"],
  ]);
  assert.deepEqual(newRunChoices([local()]), []);
});

test("mit Default-Vorlage ist diese die erste Wahl des Servers und steht nicht ein zweites Mal in der Liste", () => {
  const groups = newRunChoices([snapshot({ defaultEntry: "ragents.reference.circle" })]);
  assert.deepEqual(groups[0]?.choices.map((choice) => [choice.connection, choice.entryId, choice.title, choice.description, choice.detail]), [
    ["werkstatt", "ragents.reference.circle", "Gesprächsrunde", "Run-Script \u00b7 Standard", "Vier Agenten im Kreis"],
    ["werkstatt", "ragents.reference.board", "Sammelboard", "Skill", "Ein Board für Ideen"],
  ]);
});

test("ein Befehl nimmt den Server des gewählten Runs, sonst das einzig passende, sonst fragt er", () => {
  const zweit = snapshot({ connection: { kind: "server", name: "zweit", url: "http://localhost:4727" } });
  const snapshots = [snapshot(), zweit, local()];
  const connected = (entry: ConnectionSnapshot) => entry.status.kind === "connected";
  assert.deepEqual(resolveConnection(snapshots, "zweit", connected), { kind: "connection", name: "zweit" });
  assert.deepEqual(resolveConnection(snapshots, "core", connected), { kind: "ask", candidates: [snapshots[0], zweit] });
  assert.deepEqual(resolveConnection(snapshots, undefined, connected), { kind: "ask", candidates: [snapshots[0], zweit] });
  assert.deepEqual(resolveConnection([snapshot(), local()], undefined, connected), { kind: "connection", name: "werkstatt" });
  assert.deepEqual(resolveConnection([local()], undefined, connected), { kind: "none" });
});

test("Neuer Run belegt keine Startoption vor, die die gewählte Vorlage festlegt", () => {
  const worktree = { ...entries[1]!, fixedStartOptions: { [WORKSPACE_BINDING_OPTION_ID]: { machine: "server", folder: "fresh" } } };
  assert.equal(preselectable(worktree, WORKSPACE_BINDING_OPTION_ID), false, "der Ordner des Arbeitsplatzes bleibt draußen");
  assert.equal(preselectable(worktree, "ragents.model"), true);
  assert.equal(preselectable(entries[1], WORKSPACE_BINDING_OPTION_ID), true);
  assert.equal(preselectable(undefined, WORKSPACE_BINDING_OPTION_ID), true, "ohne Vorlage belegt Neuer Run den Ordner vor");
});
