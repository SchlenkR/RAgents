import assert from "node:assert/strict";
import test from "node:test";
import { WORKSPACE_BINDING_OPTION_ID } from "../../../plugins/ragents.workspace/contract";
import { connectedTargets, newRunChoices, panelState, pendingActions, preselectable, resolveTarget, targetView } from "../src/overview-model";
import { runSummaryFrom } from "../src/run-model";
import type { SessionStatus, TargetSnapshot } from "../src/sessions";
import { runView, session } from "./fixtures";

const entries = [
  { id: "ragents.reference.board", title: "Sammelboard", description: "Ein Board für Ideen", action: "skill" as const, category: "Mini-Apps" },
  { id: "ragents.reference.circle", title: "Gesprächsrunde", description: "Vier Agenten im Kreis", action: "script" as const, category: "Run-Scripts" },
];

const target = (overrides: Partial<TargetSnapshot> = {}): TargetSnapshot => ({
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

const local = (overrides: Partial<TargetSnapshot> = {}): TargetSnapshot => target({
  connection: { kind: "profile", name: "core", profileFile: "/x/ragents.config.core.ts" },
  status: { kind: "stopped" },
  url: undefined,
  runs: [],
  entries: [],
  canCreate: false,
  ...overrides,
});

test("die Übersicht führt Server und lokale Profile in einer Liste zusammen", () => {
  const state = panelState({ theme: "dark", page: "start", targets: [target(), local()], profileSuggestions: ["/x/ragents.config.core.ts"], missingSecrets: [], problem: undefined, pickedProfileFile: undefined, runsEnvironment: undefined });
  assert.deepEqual(state.targets.map((entry) => [entry.name, entry.kind, entry.state.kind, entry.runs.length, entry.entries.length]), [
    ["werkstatt", "server", "connected", 1, 2],
    ["core", "profile", "stopped", 0, 0],
  ]);
  assert.equal(state.targets[0]?.address, "http://localhost:4710");
  assert.equal(state.targets[1]?.address, "/x/ragents.config.core.ts");
  assert.deepEqual(state.targets[0]?.entries, [
    { id: "ragents.reference.board", title: "Sammelboard", description: "Ein Board für Ideen", kind: "skill", category: "Mini-Apps" },
    { id: "ragents.reference.circle", title: "Gesprächsrunde", description: "Vier Agenten im Kreis", kind: "script", category: "Run-Scripts" },
  ]);
  assert.deepEqual(state.profileSuggestions, ["/x/ragents.config.core.ts"]);
  assert.deepEqual(state.targets[0]?.runs[0], { id: "run-a", title: "Nachtbus-Runde", state: "running", pendingActions: 1, updatedAt: 2 });
  assert.equal(state.page, "start");
  assert.equal(state.problem, undefined);
  assert.equal(state.runsEnvironment, undefined);
  assert.equal(panelState({ theme: "dark", page: "runs", targets: [], profileSuggestions: [], missingSecrets: [], problem: undefined, pickedProfileFile: undefined, runsEnvironment: "werkstatt" }).runsEnvironment, "werkstatt");
});

test("die Zielzeile kennt das lokale Profil, den Host des Servers und den Server, dessen Profil lokal läuft", () => {
  assert.deepEqual(targetView(local()).route, { kind: "profile", profile: "core" });
  assert.deepEqual(targetView(target()).route, { kind: "server", host: "localhost:4710", localHost: false });
  assert.deepEqual(targetView(target({ connection: { kind: "server", name: "werkstatt", url: "https://workshop.example.com/" } })).route, { kind: "server", host: "workshop.example.com", localHost: false });
  assert.deepEqual(targetView(target({ connection: { kind: "server", name: "werkstatt", url: "https://workshop.example.com:8443" }, localHost: true })).route, { kind: "server", host: "workshop.example.com:8443", localHost: true });
});

test("jeder Zustand einer Sitzung wird zu einem Zustand der Karte, die Anmeldung nennt ihre Art", () => {
  const of = (status: SessionStatus) => targetView(target({ status })).state;
  assert.deepEqual(of({ kind: "starting", detail: "Host starten ..." }), { kind: "starting", detail: "Host starten ..." });
  assert.deepEqual(of({ kind: "starting", detail: undefined }), { kind: "starting" });
  assert.deepEqual(of({ kind: "failed", message: "kein Checkout" }), { kind: "failed", message: "kein Checkout" });
  assert.deepEqual(of({ kind: "login-required", tokenGate: true }), { kind: "login-required", mode: "token" });
  assert.deepEqual(of({ kind: "login-required", tokenGate: false }), { kind: "login-required", mode: "password" });
  assert.deepEqual(of({ kind: "unreachable", message: "ECONNREFUSED" }), { kind: "unreachable", message: "ECONNREFUSED" });
  assert.deepEqual(of({ kind: "forbidden", message: "Kein Zugriff" }), { kind: "forbidden", message: "Kein Zugriff" });
  assert.deepEqual(of({ kind: "connecting" }), { kind: "connecting" });
  const gescheitert = targetView(target({ problem: "Benutzerkennung oder Passwort stimmen nicht", loginUser: "alice", savedLogin: true, user: "Alice" }));
  assert.equal(gescheitert.problem, "Benutzerkennung oder Passwort stimmen nicht");
  assert.equal(gescheitert.loginUser, "alice");
  assert.equal(gescheitert.savedLogin, true);
  assert.equal(gescheitert.user, "Alice");
});

test("eine fehlende Umgebungsvariable steht als eigenes Feld in der Karte, ohne sie fehlt das Feld", () => {
  const missing = { variable: "SERVICE_TOKEN", section: "ragents.example", key: "SERVICE_KEY" };
  assert.deepEqual(targetView(target({ status: { kind: "failed", message: "endete mit Code 1" }, missingEnvironment: missing })).missingEnvironment, missing);
  assert.equal("missingEnvironment" in targetView(target()), false);
});

test("der Default-Einstieg der Umgebung steht als defaultEntry in der Karte, ohne ihn fehlt das Feld", () => {
  assert.equal(targetView(target({ defaultEntry: "ragents.reference.board" })).defaultEntry, "ragents.reference.board");
  assert.equal("defaultEntry" in targetView(target()), false);
});

test("eine Vorlage mit Leitfaden steht als geführt in der Karte, ohne ihn fehlt das Feld", () => {
  const guided = targetView(target({ entries: [{ ...entries[1]!, guide: "ragents.reference.circle-guide" }, entries[0]!] })).entries;
  assert.deepEqual(guided.map((entry) => [entry.id, entry.guided]), [["ragents.reference.circle", true], ["ragents.reference.board", undefined]]);
  assert.equal(Object.hasOwn(guided[1]!, "guided"), false);
});

test("ein Run, dessen Laufansicht nicht lesbar ist, trägt sein Problem in die Karte, sonst fehlt das Feld", () => {
  const broken = { ...runSummaryFrom(session({ id: "run-b" }), undefined), problem: "Die Laufansicht ist nicht lesbar: kaputt" };
  const runs = targetView(target({ runs: [runSummaryFrom(session(), runView()), broken] })).runs;
  assert.deepEqual(runs.map((run) => [run.id, run.problem]), [["run-a", undefined], ["run-b", "Die Laufansicht ist nicht lesbar: kaputt"]]);
  assert.equal(Object.hasOwn(runs[0]!, "problem"), false);
});

test("Zahlen der Statusleiste und des Abzeichens zählen über alle Ziele", () => {
  const targets = [target(), target({ connection: { kind: "server", name: "zweit", url: "http://localhost:4727" } }), local()];
  assert.equal(connectedTargets(targets), 2);
  assert.equal(pendingActions(targets), 2);
});

test("Neuer Run bietet je verbundenem Ziel den freien Auftrag und seine Vorlagen an", () => {
  const groups = newRunChoices([target(), local(), target({ connection: { kind: "server", name: "ohne", url: "http://localhost:4711" }, canCreate: false })]);
  assert.deepEqual(groups.map((group) => group.group), ["werkstatt"]);
  assert.deepEqual(groups[0]?.choices.map((choice) => [choice.target, choice.entryId, choice.title, choice.description]), [
    ["werkstatt", undefined, "Neuer Run", "ohne Vorlage"],
    ["werkstatt", "ragents.reference.board", "Sammelboard", "Skill"],
    ["werkstatt", "ragents.reference.circle", "Gesprächsrunde", "Run-Script"],
  ]);
  assert.deepEqual(newRunChoices([local()]), []);
});

test("mit Default-Einstieg ist dieser die erste Wahl der Umgebung und steht nicht ein zweites Mal in der Liste", () => {
  const groups = newRunChoices([target({ defaultEntry: "ragents.reference.circle" })]);
  assert.deepEqual(groups[0]?.choices.map((choice) => [choice.target, choice.entryId, choice.title, choice.description, choice.detail]), [
    ["werkstatt", "ragents.reference.circle", "Gesprächsrunde", "Run-Script \u00b7 Standard", "Vier Agenten im Kreis"],
    ["werkstatt", "ragents.reference.board", "Sammelboard", "Skill", "Ein Board für Ideen"],
  ]);
});

test("ein Befehl nimmt das Ziel des gewählten Runs, sonst das einzig passende, sonst fragt er", () => {
  const zweit = target({ connection: { kind: "server", name: "zweit", url: "http://localhost:4727" } });
  const targets = [target(), zweit, local()];
  const connected = (entry: TargetSnapshot) => entry.status.kind === "connected";
  assert.deepEqual(resolveTarget(targets, "zweit", connected), { kind: "target", name: "zweit" });
  assert.deepEqual(resolveTarget(targets, "core", connected), { kind: "ask", candidates: [targets[0], zweit] });
  assert.deepEqual(resolveTarget(targets, undefined, connected), { kind: "ask", candidates: [targets[0], zweit] });
  assert.deepEqual(resolveTarget([target(), local()], undefined, connected), { kind: "target", name: "werkstatt" });
  assert.deepEqual(resolveTarget([local()], undefined, connected), { kind: "none" });
});

test("Neuer Run belegt keine Startoption vor, die die gewählte Vorlage festlegt", () => {
  const worktree = { ...entries[1]!, fixedStartOptions: { [WORKSPACE_BINDING_OPTION_ID]: { kind: "fresh" } } };
  assert.equal(preselectable(worktree, WORKSPACE_BINDING_OPTION_ID), false, "der Ordner des Arbeitsplatzes bleibt draußen");
  assert.equal(preselectable(worktree, "ragents.model"), true);
  assert.equal(preselectable(entries[1], WORKSPACE_BINDING_OPTION_ID), true);
  assert.equal(preselectable(undefined, WORKSPACE_BINDING_OPTION_ID), true, "ohne Vorlage belegt Neuer Run den Ordner vor");
});
