import assert from "node:assert/strict";
import test from "node:test";
import { WORKSPACE_BINDING_OPTION_ID } from "../../../plugins/ragents.workspace/contract";
import { connectedCount, connectionView, newRunChoices, panelState, pendingActions, preselectable, resolveConnection } from "../src/overview-model";
import { runSummaryFrom } from "../src/run-model";
import type { ConnectionSnapshot, SessionStatus } from "../src/sessions";
import { runView, session } from "./fixtures";

const entries = [
  { id: "ragents.reference.board", title: "Collection board", description: "A board for ideas", action: "skill" as const, category: "Mini-apps" },
  { id: "ragents.reference.circle", title: "Conversation circle", description: "Four agents in a circle", action: "script" as const, category: "Run scripts" },
];

const snapshot = (overrides: Partial<ConnectionSnapshot> = {}): ConnectionSnapshot => ({
  connection: { kind: "server", name: "workshop", url: "http://localhost:4710" },
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
  versionNotice: undefined,
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

test("the overview combines servers and local profiles in one list", () => {
  const state = panelState({ theme: "dark", page: "start", connections: [snapshot(), local()], profileSuggestions: ["/x/ragents.config.core.ts"], missingSecrets: [], problem: undefined, pickedProfileFile: undefined, runsConnection: undefined });
  assert.deepEqual(state.connections.map((entry) => [entry.name, entry.kind, entry.state.kind, entry.runs.length, entry.entries.length]), [
    ["workshop", "server", "connected", 1, 2],
    ["core", "profile", "stopped", 0, 0],
  ]);
  assert.equal(state.connections[0]?.address, "http://localhost:4710");
  assert.equal(state.connections[1]?.address, "/x/ragents.config.core.ts");
  assert.deepEqual(state.connections[0]?.entries, [
    { id: "ragents.reference.board", title: "Collection board", description: "A board for ideas", kind: "skill", category: "Mini-apps" },
    { id: "ragents.reference.circle", title: "Conversation circle", description: "Four agents in a circle", kind: "script", category: "Run scripts" },
  ]);
  assert.deepEqual(state.profileSuggestions, ["/x/ragents.config.core.ts"]);
  assert.deepEqual(state.connections[0]?.runs[0], { id: "run-a", title: "Night bus round", state: "running", pendingActions: 1, updatedAt: 2 });
  assert.equal(state.page, "start");
  assert.equal(state.problem, undefined);
  assert.equal(state.runsConnection, undefined);
  assert.equal(panelState({ theme: "dark", page: "runs", connections: [], profileSuggestions: [], missingSecrets: [], problem: undefined, pickedProfileFile: undefined, runsConnection: "workshop" }).runsConnection, "workshop");
});

test("the target line knows the local profile, the host of the server, and the server whose profile runs locally", () => {
  assert.deepEqual(connectionView(local()).route, { kind: "profile", profile: "core" });
  assert.deepEqual(connectionView(snapshot()).route, { kind: "server", host: "localhost:4710", localHost: false });
  assert.deepEqual(connectionView(snapshot({ connection: { kind: "server", name: "workshop", url: "https://workshop.example.com/" } })).route, { kind: "server", host: "workshop.example.com", localHost: false });
  assert.deepEqual(connectionView(snapshot({ connection: { kind: "server", name: "workshop", url: "https://workshop.example.com:8443" }, localHost: true })).route, { kind: "server", host: "workshop.example.com:8443", localHost: true });
});

test("every state of a session becomes a state of the card, the sign-in names its kind", () => {
  const of = (status: SessionStatus) => connectionView(snapshot({ status })).state;
  assert.deepEqual(of({ kind: "starting", detail: "Starting host ..." }), { kind: "starting", detail: "Starting host ..." });
  assert.deepEqual(of({ kind: "starting", detail: undefined }), { kind: "starting" });
  assert.deepEqual(of({ kind: "failed", message: "no checkout" }), { kind: "failed", message: "no checkout" });
  assert.deepEqual(of({ kind: "login-required", tokenGate: true }), { kind: "login-required", mode: "token" });
  assert.deepEqual(of({ kind: "login-required", tokenGate: false }), { kind: "login-required", mode: "password" });
  assert.deepEqual(of({ kind: "unreachable", message: "ECONNREFUSED" }), { kind: "unreachable", message: "ECONNREFUSED" });
  assert.deepEqual(of({ kind: "forbidden", message: "No access" }), { kind: "forbidden", message: "No access" });
  assert.deepEqual(of({ kind: "connecting" }), { kind: "connecting" });
  const failed = connectionView(snapshot({ problem: "User id or password is incorrect", loginUser: "alice", savedLogin: true, user: "Alice" }));
  assert.equal(failed.problem, "User id or password is incorrect");
  assert.equal(failed.loginUser, "alice");
  assert.equal(failed.savedLogin, true);
  assert.equal(failed.user, "Alice");
});

test("a missing environment variable is its own field in the card, without it the field is absent", () => {
  const missing = { variable: "SERVICE_TOKEN", section: "ragents.example", key: "SERVICE_KEY" };
  assert.deepEqual(connectionView(snapshot({ status: { kind: "failed", message: "ended with code 1" }, missingEnvironment: missing })).missingEnvironment, missing);
  assert.equal("missingEnvironment" in connectionView(snapshot()), false);
});

test("the default template of the server is defaultEntry in the card, without it the field is absent", () => {
  assert.equal(connectionView(snapshot({ defaultEntry: "ragents.reference.board" })).defaultEntry, "ragents.reference.board");
  assert.equal("defaultEntry" in connectionView(snapshot()), false);
});

test("a template with a guide is marked as guided in the card, without it the field is absent", () => {
  const guided = connectionView(snapshot({ entries: [{ ...entries[1]!, guide: "ragents.reference.circle-guide" }, entries[0]!] })).entries;
  assert.deepEqual(guided.map((entry) => [entry.id, entry.guided]), [["ragents.reference.circle", true], ["ragents.reference.board", undefined]]);
  assert.equal(Object.hasOwn(guided[1]!, "guided"), false);
});

test("a run whose run view is not readable carries its problem into the card, otherwise the field is absent", () => {
  const broken = { ...runSummaryFrom(session({ id: "run-b" }), undefined), problem: "The run view is not readable: broken" };
  const runs = connectionView(snapshot({ runs: [runSummaryFrom(session(), runView()), broken] })).runs;
  assert.deepEqual(runs.map((run) => [run.id, run.problem]), [["run-a", undefined], ["run-b", "The run view is not readable: broken"]]);
  assert.equal(Object.hasOwn(runs[0]!, "problem"), false);
});

test("numbers of the status bar and the badge count across all servers", () => {
  const snapshots = [snapshot(), snapshot({ connection: { kind: "server", name: "second", url: "http://localhost:4727" } }), local()];
  assert.equal(connectedCount(snapshots), 2);
  assert.equal(pendingActions(snapshots), 2);
});

test("New run offers the free task and its templates per connected server", () => {
  const groups = newRunChoices([snapshot(), local(), snapshot({ connection: { kind: "server", name: "none", url: "http://localhost:4711" }, canCreate: false })]);
  assert.deepEqual(groups.map((group) => group.group), ["workshop"]);
  assert.deepEqual(groups[0]?.choices.map((choice) => [choice.connection, choice.entryId, choice.title, choice.description]), [
    ["workshop", undefined, "New run", "no template"],
    ["workshop", "ragents.reference.board", "Collection board", "Skill"],
    ["workshop", "ragents.reference.circle", "Conversation circle", "Run script"],
  ]);
  assert.deepEqual(newRunChoices([local()]), []);
});

test("with a default template, it is the server's first choice and does not appear a second time in the list", () => {
  const groups = newRunChoices([snapshot({ defaultEntry: "ragents.reference.circle" })]);
  assert.deepEqual(groups[0]?.choices.map((choice) => [choice.connection, choice.entryId, choice.title, choice.description, choice.detail]), [
    ["workshop", "ragents.reference.circle", "Conversation circle", "Run script \u00b7 Default", "Four agents in a circle"],
    ["workshop", "ragents.reference.board", "Collection board", "Skill", "A board for ideas"],
  ]);
});

test("a command takes the server of the selected run, otherwise the only matching one, otherwise it asks", () => {
  const second = snapshot({ connection: { kind: "server", name: "second", url: "http://localhost:4727" } });
  const snapshots = [snapshot(), second, local()];
  const connected = (entry: ConnectionSnapshot) => entry.status.kind === "connected";
  assert.deepEqual(resolveConnection(snapshots, "second", connected), { kind: "connection", name: "second" });
  assert.deepEqual(resolveConnection(snapshots, "core", connected), { kind: "ask", candidates: [snapshots[0], second] });
  assert.deepEqual(resolveConnection(snapshots, undefined, connected), { kind: "ask", candidates: [snapshots[0], second] });
  assert.deepEqual(resolveConnection([snapshot(), local()], undefined, connected), { kind: "connection", name: "workshop" });
  assert.deepEqual(resolveConnection([local()], undefined, connected), { kind: "none" });
});

test("New run presets no start option that the selected template fixes", () => {
  const worktree = { ...entries[1]!, fixedStartOptions: { [WORKSPACE_BINDING_OPTION_ID]: { machine: "server", folder: "fresh" } } };
  assert.equal(preselectable(worktree, WORKSPACE_BINDING_OPTION_ID), false, "the workspace folder stays out");
  assert.equal(preselectable(worktree, "ragents.model"), true);
  assert.equal(preselectable(entries[1], WORKSPACE_BINDING_OPTION_ID), true);
  assert.equal(preselectable(undefined, WORKSPACE_BINDING_OPTION_ID), true, "without a template, New run presets the folder");
});

test("a different version shows with level and text at the server; which side needs updating is only needed by the notification", () => {
  const notice = { level: "warning" as const, text: "RAgents version does not match: extension 0.1.9, server 0.1.8 - update the server to 0.1.9.", update: "server" as const };
  assert.deepEqual(connectionView(snapshot({ versionNotice: notice })).versionNotice, { level: "warning", text: notice.text });
  assert.equal("versionNotice" in connectionView(snapshot()), false);
});
