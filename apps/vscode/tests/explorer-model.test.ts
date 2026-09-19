import assert from "node:assert/strict";
import test from "node:test";
import { childNodes, parentId, rootNodes, type ExplorerState } from "../src/explorer-model";
import { runSummaryFrom } from "../src/run-model";
import { runView, session } from "./fixtures";

const state = (overrides: Partial<ExplorerState> = {}): ExplorerState => ({
  status: { kind: "connected" },
  streamMessage: undefined,
  serverUrl: "http://localhost:4710",
  runs: [runSummaryFrom(session(), runView())],
  selectedRunId: "run-a",
  centerElements: () => new Set(),
  workspaceClient: { kind: "idle" },
  ...overrides,
});

test("connection problems become notice rows with a command instead of an empty tree", () => {
  assert.deepEqual(rootNodes(state({ status: { kind: "unreachable", message: "ECONNREFUSED" } })).map((node) => node.kind === "notice" && [node.label, node.command]), [
    ["Server nicht erreichbar", undefined], ["Erneut verbinden", "ragents.connect"],
  ]);
  const login = rootNodes(state({ status: { kind: "login-required", tokenGate: true } }));
  assert.equal(login[1]?.kind === "notice" && login[1].label, "Zugangstoken eingeben");
  assert.equal(rootNodes(state({ runs: [] }))[0]?.label, "Noch keine Runs");
  assert.equal(rootNodes(state({ streamMessage: "abgebrochen" }))[0]?.label, "Live-Verbindung unterbrochen");
  const failed = rootNodes(state({ workspaceClient: { kind: "failed", message: "Der Server antwortete mit 500." } }))[0];
  assert.equal(failed?.kind === "notice" && failed.tooltip, "Der Server antwortete mit 500.");
  assert.equal(failed?.label, "Arbeitsplatz nicht angemeldet");
});

test("runs carry state, questions and colour; their sections expose actors, apps, files and the journal", () => {
  const [run] = rootNodes(state());
  assert.ok(run?.kind === "run");
  assert.equal(run.description, "1 aktiv \u00b7 1 Rückfrage");
  assert.equal(run.color, "charts.green");
  assert.equal(run.selected, true);
  const sections = childNodes(state(), run);
  assert.deepEqual(sections.map((node) => [node.label, node.description]), [["Actors", "4"], ["Mini-Apps", "1"], ["Dateien", "1"], ["Journal", "12 Ereignisse"]]);
  const actors = childNodes(state(), sections[0]!);
  assert.deepEqual(actors.map((node) => node.kind === "actor" && [node.label, node.description, node.icon, node.color]), [
    ["@coordinator", "Koordinator \u00b7 bereit", "sparkle", undefined],
    ["@mira", "arbeitet", "hubot", "charts.green"],
    ["@jon", "2 Aufträge warten \u00b7 1 Rückfrage", "hubot", undefined],
    ["@conversation-circle", "gestoppt", "code", "disabledForeground"],
  ]);
  assert.deepEqual(parentId(actors[0]!), "run:run-a:actors");
  assert.deepEqual(parentId(sections[3]!), "run:run-a");
});

test("apps report whether they lie in the column or in the centre", () => {
  const [run] = rootNodes(state());
  const apps = childNodes(state(), childNodes(state(), run!)[1]!);
  assert.equal(apps[0]?.kind === "app" && apps[0].placement, "column");
  assert.equal(apps[0]?.description, "rechts \u00b7 !");
  const centered = state({ centerElements: () => new Set(["decision--main"]) });
  const [centeredRun] = rootNodes(centered);
  const centeredApps = childNodes(centered, childNodes(centered, centeredRun!)[1]!);
  assert.equal(centeredApps[0]?.kind === "app" && centeredApps[0].placement, "center");
  assert.equal(centeredApps[0]?.description, "in der Mitte \u00b7 !");
});

test("a run without a loaded view shows a loading row instead of empty sections", () => {
  const unloaded = state({ runs: [runSummaryFrom(session(), undefined)] });
  const [run] = rootNodes(unloaded);
  assert.equal(childNodes(unloaded, run!)[0]?.label, "Laufansicht wird geladen ...");
});
