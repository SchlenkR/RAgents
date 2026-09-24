import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type { Browser } from "playwright-core";
import {
  WorkspaceOperationExecutor,
  browserModule,
  workspaceProcessContext,
  type BrowserModuleOptions,
} from "@ragents/workspace-executor";
import { RunBrowser } from "../../../plugins/ragents.browser/server/browser.ts";
import { createBrowserFunctions, createBrowserImageContribution } from "../../../plugins/ragents.browser/server/tools.ts";
import { stubBrowser, type StubDocument } from "../../../packages/workspace-executor/tests/browser-stub.ts";

const unusedSandbox = { execute: async () => { throw new Error("Dieser Test ruft keinen Executor"); } };

const site: Readonly<Record<string, StubDocument>> = {
  "/": {
    title: "Entwurf",
    elements: [
      { role: "button", name: "Speichern", onClick: (page) => page.show({ role: "status", name: "Gespeichert" }) },
      { role: "button", name: "Weiter", onClick: (page) => page.navigate("/zwei") },
    ],
  },
  "/zwei": { title: "Zweite Seite", elements: [] },
};

/** Der Server-Teil über dem Executor des Servers; der Browser selbst ist ein Modul dieses Executors. */
const localBrowser = (options: BrowserModuleOptions, filesFor: (runId: string) => Promise<string> = async () => "/unused") => {
  const executor = new WorkspaceOperationExecutor({
    contextFor: async (runId) => workspaceProcessContext({
      runId, cwd: tmpdir(), root: tmpdir(), home: { home: tmpdir() }, logDirectory: tmpdir(), hostRoot: undefined,
    }),
    modules: [browserModule({ timeoutMs: 500, checkTimeoutMs: 50, ...options })],
  });
  return { browser: new RunBrowser({ sandbox: executor, filesFor }), executor };
};

const documentsIn = async (t: TestContext): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-browser-documents-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

test("Browserwerkzeuge deklarieren typisierte Ergebnisse und eine eigene native Bildanzeige", () => {
  const browser = new RunBrowser({ sandbox: unusedSandbox, filesFor: async () => "/unused" });
  const functions = createBrowserFunctions(browser);
  assert.equal(functions.length, 11);
  const viewport = functions.find((entry) => entry.name === "browser_viewport");
  assert.deepEqual(Object.keys(viewport!.schema.properties), ["width", "height"]);
  const check = functions.find((entry) => entry.name === "browser_check");
  assert.deepEqual(Object.keys(check!.schema.properties), ["target", "text", "url", "count", "noErrors"]);
  const click = functions.find((entry) => entry.name === "browser_click");
  assert.deepEqual(Object.keys((click!.schema.properties as { target: { properties: object } }).target.properties), ["role", "name", "label", "text", "testId", "css", "frame", "nth", "first"]);
  for (const fn of functions) {
    assert.ok(fn.schema);
    assert.ok(fn.resultSchema);
    assert.equal(fn.executionMode, "sequential");
  }
  assert.equal(functions.find((entry) => entry.name === "browser_view_screenshot")?.nativeTool, true);
});

test("Native Bildanzeige löst den Run serverseitig auf und weist Modelle ohne Bilder ab", async () => {
  const requested: string[] = [];
  class ImageBrowser extends RunBrowser {
    override async image(runId: string): Promise<Buffer> {
      requested.push(runId);
      return Buffer.from("screenshot");
    }
  }
  const browser = new ImageBrowser({ sandbox: unusedSandbox, filesFor: async () => "/unused" });
  const contribution = createBrowserImageContribution(browser);
  const agent = { runId: "this-run", agentId: "actor", audience: "agent" as const, workspace: "/unused" };
  const handler = (outcome: { toolName: string; isError: boolean }, modelReadsImages: boolean) =>
    contribution.afterToolCall!(agent, outcome, { signal: undefined, modelReadsImages });
  const outcome = { toolName: "browser_view_screenshot", isError: false };
  const rejected = await handler(outcome, false);
  assert.equal(rejected?.isError, true);
  assert.match(JSON.stringify(rejected?.content), /unterstützt keine Bilder/);
  assert.deepEqual(requested, []);
  const result = await handler(outcome, true);
  assert.deepEqual(requested, ["this-run"]);
  assert.deepEqual(result?.content, [
    { type: "text", text: "Letzte Browseraufnahme dieses Runs." },
    { type: "image", data: Buffer.from("screenshot").toString("base64"), mimeType: "image/png" },
  ]);
  assert.equal(await handler({ ...outcome, toolName: "browser_snapshot" }, true), undefined);
  assert.equal(await handler({ ...outcome, isError: true }, true), undefined);
});

test("Fehlender Browser und Aufnahmen sind klare Fehler ohne künstlichen Erfolg", async () => {
  const { browser } = localBrowser({ launch: async () => { throw new Error("Kein ausführbarer Browser: BROWSER_EXECUTABLE_PATH setzen"); } });
  await assert.rejects(browser.open("one", "http://127.0.0.1"), /BROWSER_EXECUTABLE_PATH/);
  assert.equal(browser.evidence("one").url, undefined);
  await assert.rejects(browser.image("one"), /noch keinen Browser-Screenshot/);
  await assert.rejects(browser.snapshot("other"), /Zuerst browser_open/);
  await assert.rejects(browser.open("other", "file:///etc/hosts"), /HTTP- oder HTTPS/);
  await browser.shutdown();
  await assert.rejects(browser.open("one", "http://127.0.0.1"), /Browserdienst ist beendet/);
});

test("Run-Stopp schließt auch einen noch startenden Browser und startet keine Seite", async () => {
  let finishLaunch: ((browser: Browser) => void) | undefined;
  let closed = 0;
  let contexts = 0;
  const { browser } = localBrowser({ launch: () => new Promise((resolve) => { finishLaunch = resolve; }) });
  await browser.restore("one");
  const opened = browser.open("one", "http://127.0.0.1");
  const rejected = assert.rejects(opened, /Browser wurde beendet/);
  while (!finishLaunch) await new Promise((resolve) => setTimeout(resolve, 5));
  const stopped = browser.close("one");
  finishLaunch({
    close: async () => { closed += 1; },
    newContext: async () => { contexts += 1; throw new Error("unexpected context"); },
  } as unknown as Browser);
  await Promise.all([rejected, stopped]);
  assert.equal(closed, 1);
  assert.equal(contexts, 0);
  assert.deepEqual(browser.evidence("one"), { screenshots: [], currentScreenshots: [], errors: [] });
});

test("Bereits abgebrochene Browseröffnung startet keinen Prozess", async () => {
  let launches = 0;
  const { browser } = localBrowser({ launch: async () => { launches += 1; throw new Error("unexpected launch"); } });
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(browser.open("one", "http://127.0.0.1", { signal: abort.signal }), /abort/i);
  assert.equal(launches, 0);
});

test("die Evidenz hält der Server: Prüfzeit mit seiner Uhr, Aufnahmen in seiner Ablage, Viewport über den Browserneustart", async (t) => {
  const documents = await documentsIn(t);
  const stub = stubBrowser(site);
  const { browser } = localBrowser({ launch: stub.launch }, async (runId) => path.join(documents, runId));
  t.after(() => browser.shutdown());

  await browser.open("one", "http://localhost:4173/");
  assert.deepEqual(browser.evidence("one"), { url: "http://localhost:4173/", screenshots: [], currentScreenshots: [], errors: [] });
  await browser.click("one", { role: "button", name: "Speichern" });
  const before = Date.now();
  const checked = await browser.check("one", { target: { role: "status" }, text: "Gespeichert" });
  assert.ok(Date.parse(checked.checkedAt) >= before - 1 && Date.parse(checked.checkedAt) <= Date.now());
  assert.equal(browser.evidence("one").checkedAt, checked.checkedAt);

  const shot = await browser.screenshot("one", { label: "Gespeichert" });
  assert.match(shot.path, /^browser\/[a-f0-9-]{36}\.png$/);
  assert.equal(await readFile(path.join(documents, "one", shot.path), "utf8"), "PNG 1920x1080");
  assert.equal((await browser.image("one")).toString(), "PNG 1920x1080");
  assert.match(shot.url, /^\/api\/plugins\/ragents.documents\/runs\/one\/files\/content\?path=browser/);
  await browser.snapshot("one");
  assert.deepEqual(browser.evidence("one"), {
    checkedAt: checked.checkedAt,
    url: "http://localhost:4173/",
    screenshots: [{ name: "Gespeichert", url: shot.url }],
    currentScreenshots: [{ name: "Gespeichert", url: shot.url }],
    errors: [],
  });

  stub.page().consoleError("Später gemeldet");
  await assert.rejects(browser.check("one", { noErrors: true }), /Später gemeldet/);
  assert.equal(browser.evidence("one").checkedAt, undefined, "eine gescheiterte Prüfung verwirft die Zeit auch beim Server");
  assert.deepEqual(browser.evidence("one").errors, ["Konsole: Später gemeldet"]);
  await browser.check("one", { text: "Gespeichert", noErrors: false });
  await browser.click("one", { role: "button", name: "Weiter" });
  assert.deepEqual(browser.evidence("one"), {
    url: "http://localhost:4173/zwei",
    screenshots: [{ name: "Gespeichert", url: shot.url }],
    currentScreenshots: [],
    errors: [],
  });

  await browser.viewport("one", { width: 390, height: 844 });
  await browser.close("one");
  assert.equal(stub.log.closes, 1);
  assert.equal(browser.evidence("one").url, undefined);
  await browser.open("one", "http://localhost:4173/");
  const narrow = await browser.screenshot("one", { label: "Schmal" });
  assert.equal(await readFile(path.join(documents, "one", narrow.path), "utf8"), "PNG 390x844");

  const restored = new RunBrowser({ sandbox: unusedSandbox, filesFor: async (runId) => path.join(documents, runId) });
  await restored.restore("one");
  assert.deepEqual(restored.evidence("one").screenshots.map((entry) => entry.name), ["Gespeichert", "Schmal"]);
  assert.equal((await restored.image("one")).toString(), "PNG 390x844");
});

test("gleichzeitige Aufnahmen eines Runs landen alle in der Aufnahmeliste", async (t) => {
  const documents = await documentsIn(t);
  const { browser } = localBrowser({ launch: stubBrowser(site).launch }, async () => documents);
  t.after(() => browser.shutdown());
  await browser.open("one", "http://localhost:4173/");
  await Promise.all(["A", "B", "C"].map((label) => browser.screenshot("one", { label })));
  const manifest = JSON.parse(await readFile(path.join(documents, "browser", ".captures.json"), "utf8")) as { name: string }[];
  assert.deepEqual(manifest.map((entry) => entry.name).sort(), ["A", "B", "C"]);
  assert.equal(browser.evidence("one").currentScreenshots.length, 3);
});
