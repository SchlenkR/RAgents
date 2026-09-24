import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright-core";
import {
  BROWSER_EXECUTABLE_VARIABLE,
  BROWSER_OPERATIONS,
  WorkspaceOperationError,
  WorkspaceOperationExecutor,
  browserModule,
  workspaceProcessContext,
  type BrowserCheckResult,
  type BrowserModuleOptions,
  type BrowserPageState,
  type BrowserSnapshot,
  type BrowserStep,
} from "../src/index.ts";
import { browserLocator } from "../src/browser/pages.ts";
import { browserExecutable, hostPlaywright } from "../src/browser/playwright.ts";
import { stubBrowser, type StubDocument } from "./browser-stub.ts";

const hostRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const site: Readonly<Record<string, StubDocument>> = {
  "/": {
    title: "Entwurf",
    elements: [
      { role: "button", name: "Speichern", onClick: (page) => page.show({ role: "status", name: "Gespeichert" }) },
      { role: "button", name: "Fehler auslösen", onClick: (page) => page.consoleError("Absichtlicher Fehler") },
      { role: "button", name: "Weiter", onClick: (page) => page.navigate("/zwei") },
      { role: "textbox", name: "Titel", label: "Titel" },
    ],
  },
  "/zwei": { title: "Zweite Seite", elements: [{ role: "link", name: "Zurück" }, { role: "link", name: "Start" }] },
};

const viewport = { width: 1280, height: 720 };

const executorWith = (options: BrowserModuleOptions) => new WorkspaceOperationExecutor({
  contextFor: async (runId) => workspaceProcessContext({
    runId, cwd: tmpdir(), root: tmpdir(), home: { home: tmpdir() }, logDirectory: tmpdir(), hostRoot: undefined,
  }),
  modules: [browserModule({ timeoutMs: 500, checkTimeoutMs: 50, ...options })],
});

const coded = (code: string) => (error: unknown): boolean => error instanceof WorkspaceOperationError && error.code === code;

test("die Seite eines Runs lebt im Modul: jede Operation meldet Ergebnis und Stand der Seite", async (t) => {
  const stub = stubBrowser(site);
  const executor = executorWith({ launch: stub.launch });
  t.after(() => executor.shutdown());
  const run = <T>(operation: string, input: unknown = null) => executor.execute("run-1", operation, input) as Promise<BrowserStep<T>>;

  const opened = await run<BrowserSnapshot>(BROWSER_OPERATIONS.open, { url: "http://localhost:4173/", viewport });
  assert.equal(opened.result.title, "Entwurf");
  assert.match(opened.result.snapshot, /button "Speichern" \[ref=e1\]/);
  assert.deepEqual(opened.page, { url: "http://localhost:4173/", checked: false, errors: [], screenshots: [] });

  await run(BROWSER_OPERATIONS.fill, { target: { label: "Titel" }, value: "Neu" });
  const clicked = await run<BrowserSnapshot>(BROWSER_OPERATIONS.click, { target: { role: "button", name: "Speichern" } });
  assert.match(clicked.result.snapshot, /status "Gespeichert"/);
  const checked = await run<BrowserCheckResult>(BROWSER_OPERATIONS.check, { target: { role: "status" }, text: "Gespeichert" });
  assert.deepEqual(checked.result, { url: "http://localhost:4173/", assertions: ["Ziel ist sichtbar", "Text im Ziel: Gespeichert", "Keine erfassten Browser- oder Netzwerkfehler seit der Navigation"] });
  assert.equal(checked.page.checked, true);

  const shot = await run<string>(BROWSER_OPERATIONS.screenshot, { id: "aufnahme-1", fullPage: false });
  assert.equal(Buffer.from(shot.result, "base64").toString(), "PNG 1280x720");
  assert.deepEqual(shot.page, { url: "http://localhost:4173/", checked: true, errors: [], screenshots: ["aufnahme-1"] });
  await run(BROWSER_OPERATIONS.viewport, { width: 390, height: 844 });
  const narrow = await run<string>(BROWSER_OPERATIONS.screenshot, { id: "aufnahme-2", fullPage: true });
  assert.equal(Buffer.from(narrow.result, "base64").toString(), "PNG 390x844 ganze Seite");
  assert.deepEqual(narrow.page.screenshots, ["aufnahme-1", "aufnahme-2"]);
  assert.equal((await run<BrowserSnapshot>(BROWSER_OPERATIONS.snapshot)).page.checked, true);

  const pressed = await run(BROWSER_OPERATIONS.press, { target: { label: "Titel" }, key: "Enter" });
  assert.deepEqual(pressed.page, { url: "http://localhost:4173/", checked: false, errors: [], screenshots: [] });
  await run(BROWSER_OPERATIONS.select, { target: { label: "Titel" }, label: "Feature" });
  assert.deepEqual(stub.log.actions, ["fill Titel=Neu", "click Speichern", "press Titel Enter", "select Titel=Feature"]);

  stub.page().consoleError("Später gemeldet");
  assert.deepEqual((await executor.execute("run-1", BROWSER_OPERATIONS.state, null) as BrowserPageState).errors, ["Konsole: Später gemeldet"]);
  await assert.rejects(run(BROWSER_OPERATIONS.check, { noErrors: true }), /Browserfehler: Konsole: Später gemeldet/);
  const failed = await executor.execute("run-1", BROWSER_OPERATIONS.state, null) as BrowserPageState;
  assert.equal(failed.checked, false);
  await run(BROWSER_OPERATIONS.check, { text: "Gespeichert", noErrors: false });
  const navigated = await run<BrowserSnapshot>(BROWSER_OPERATIONS.click, { target: { role: "button", name: "Weiter" } });
  assert.equal(navigated.result.title, "Zweite Seite");
  assert.deepEqual(navigated.page, { url: "http://localhost:4173/zwei", checked: false, errors: [], screenshots: [] });
  assert.equal(stub.log.launches, 1);
  assert.equal(stub.log.contexts, 1);
});

test("Mehrdeutige, fehlende und ungültige Eingaben sind Fehler mit Ursache", async (t) => {
  const stub = stubBrowser(site);
  const executor = executorWith({ launch: stub.launch });
  t.after(() => executor.shutdown());
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.snapshot, null), /Für diesen Run ist kein Browser offen. Zuerst browser_open aufrufen/);
  assert.equal(await executor.execute("run-1", BROWSER_OPERATIONS.state, null), null);
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.open, { url: "file:///etc/hosts", viewport }), /HTTP- oder HTTPS/);
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.open, { url: "http://localhost/" }), coded("browser-input-invalid"));
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.open, { url: "http://localhost/", viewport: { width: 0, height: 10 } }), coded("browser-input-invalid"));
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.open, "http://localhost/"), coded("browser-input-invalid"));
  assert.equal(stub.log.launches, 0);

  await executor.execute("run-1", BROWSER_OPERATIONS.open, { url: "http://localhost/zwei", viewport });
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.click, {}), coded("browser-input-invalid"));
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.click, { target: { role: "link" } }),
    /strict mode violation[\s\S]*nth \(0-basiert\) oder first: true/);
  await executor.execute("run-1", BROWSER_OPERATIONS.click, { target: { role: "link", nth: 1 } });
  await executor.execute("run-1", BROWSER_OPERATIONS.check, { target: { role: "link" }, count: 2 });
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.check, { target: { role: "link" }, count: 3 }), /Erwartet 3 sichtbare Treffer, gefunden 2/);
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.check, {}), /mindestens target, text, url oder noErrors/);
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.screenshot, { fullPage: true }), coded("browser-input-invalid"));
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.open, { url: "http://localhost/fehlt", viewport }), /Browsernavigation fehlgeschlagen: HTTP 404/);
  assert.deepEqual((await executor.execute("run-1", BROWSER_OPERATIONS.state, null) as BrowserPageState).errors, ["HTTP 404: http://localhost/fehlt"]);
});

test("Schließen, Run-Stopp und Shutdown beenden den Browser; nach dem Shutdown startet keiner mehr", async () => {
  const stub = stubBrowser(site);
  const executor = executorWith({ launch: stub.launch });
  await executor.execute("eins", BROWSER_OPERATIONS.open, { url: "http://localhost/", viewport });
  assert.equal(await executor.execute("eins", BROWSER_OPERATIONS.close, null), null);
  assert.equal(stub.log.closes, 1);
  assert.equal(await executor.execute("eins", BROWSER_OPERATIONS.state, null), null);
  assert.equal(await executor.execute("eins", BROWSER_OPERATIONS.close, null), null);
  assert.equal(stub.log.closes, 1);

  await executor.execute("eins", BROWSER_OPERATIONS.open, { url: "http://localhost/", viewport });
  await executor.execute("zwei", BROWSER_OPERATIONS.open, { url: "http://localhost/", viewport });
  await executor.stopRun("eins");
  assert.equal(stub.log.closes, 2);
  assert.notEqual(await executor.execute("zwei", BROWSER_OPERATIONS.state, null), null);
  await executor.shutdown();
  assert.equal(stub.log.closes, 3);
  assert.equal(await executor.execute("zwei", BROWSER_OPERATIONS.state, null), null);
  await assert.rejects(executor.execute("zwei", BROWSER_OPERATIONS.open, { url: "http://localhost/", viewport }), /Der Browserdienst dieses Executors ist beendet/);
  await assert.rejects(executor.execute("zwei", BROWSER_OPERATIONS.snapshot, null), /Der Browserdienst dieses Executors ist beendet/);
  assert.equal(await executor.execute("zwei", BROWSER_OPERATIONS.close, null), null);
  assert.equal(stub.log.launches, 3);
  await executor.shutdown();
});

test("Abbruch und Stopp während des Starts schließen den Browser, ohne eine Seite zu öffnen", async () => {
  let launches = 0;
  let finishLaunch!: (browser: Browser) => void;
  const executor = executorWith({ launch: () => {
    launches += 1;
    return new Promise((resolve) => { finishLaunch = resolve; });
  } });
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(executor.execute("eins", BROWSER_OPERATIONS.open, { url: "http://localhost/", viewport }, { signal: aborted.signal }), /abort/i);
  assert.equal(launches, 0);

  const opened = executor.execute("eins", BROWSER_OPERATIONS.open, { url: "http://localhost/", viewport });
  const rejected = assert.rejects(opened, /Browser wurde beendet/);
  assert.equal(launches, 1);
  let closed = 0;
  let contexts = 0;
  const stopped = executor.stopRun("eins");
  finishLaunch({
    close: async () => { closed += 1; },
    newContext: async () => { contexts += 1; throw new Error("unerwarteter Kontext"); },
  } as unknown as Browser);
  await Promise.all([rejected, stopped]);
  assert.equal(closed, 1);
  assert.equal(contexts, 0);

  const stub = stubBrowser({ "/": { title: "Langsam", elements: [{ role: "button", name: "Hängt", onClick: () => new Promise(() => undefined) }] } });
  const slow = executorWith({ launch: stub.launch });
  await slow.execute("eins", BROWSER_OPERATIONS.open, { url: "http://localhost/", viewport });
  const queued = new AbortController();
  queued.abort();
  await assert.rejects(slow.execute("eins", BROWSER_OPERATIONS.snapshot, null, { signal: queued.signal }), /abort/i);
  assert.notEqual(await slow.execute("eins", BROWSER_OPERATIONS.state, null), null, "ein Abbruch vor dem Start lässt den Browser offen");
  const abort = new AbortController();
  const pending = slow.execute("eins", BROWSER_OPERATIONS.click, { target: { role: "button", name: "Hängt" } }, { signal: abort.signal });
  const ended = assert.rejects(pending, /closed|abort/i);
  while (!stub.log.actions.includes("click Hängt")) await new Promise((resolve) => setTimeout(resolve, 5));
  abort.abort();
  await ended;
  assert.equal(stub.log.closes, 1);
  assert.equal(await slow.execute("eins", BROWSER_OPERATIONS.state, null), null);
  await slow.shutdown();
});

test("Browserziele sind eindeutig beschrieben und benötigen keine Element-IDs", () => {
  const locator = (role: string, input: unknown, pick?: string | number) => ({ role, input, pick, first: () => locator(role, input, "first"), nth: (index: number) => locator(role, input, index) });
  const page = { getByRole: (role: string, input: unknown) => locator(role, input) } as unknown as Page;
  const resolved = (target: Parameters<typeof browserLocator>[1]) => { const { first: _first, nth: _nth, ...rest } = browserLocator(page, target) as unknown as ReturnType<typeof locator>; return rest; };
  assert.deepEqual(resolved({ role: "button", name: "Speichern" }), { role: "button", input: { name: "Speichern", exact: true }, pick: undefined });
  assert.deepEqual(resolved({ role: "button", first: true }), { role: "button", input: { name: undefined, exact: true }, pick: "first" });
  assert.deepEqual(resolved({ role: "button", nth: 2 }), { role: "button", input: { name: undefined, exact: true }, pick: 2 });
  assert.throws(() => browserLocator(page, {}), /genau role/);
  assert.throws(() => browserLocator(page, { name: "Speichern" }), /genau role/);
  assert.throws(() => browserLocator(page, { role: "button", css: "button" }), /genau role/);
  assert.throws(() => browserLocator(page, { role: "button", nth: 1, first: true }), /entweder nth oder first/);
});

test("playwright-core kommt aus dem Host dieser Maschine, Chrome aus ihrer Umgebung oder der Provisionierung", async () => {
  assert.throws(() => hostPlaywright(undefined), /kein Host bekannt, aus dem sich playwright-core auflösen ließe/);
  assert.throws(() => hostPlaywright(path.join(tmpdir(), "kein-host-hier")), /playwright-core liegt nicht im Host/);
  const playwright = hostPlaywright(hostRoot);
  assert.equal(typeof playwright.chromium.launch, "function");
  assert.equal(await browserExecutable(playwright, { [BROWSER_EXECUTABLE_VARIABLE]: process.execPath }), process.execPath);
  await assert.rejects(browserExecutable(playwright, { [BROWSER_EXECUTABLE_VARIABLE]: "/kein/chrome" }),
    /BROWSER_EXECUTABLE_PATH nennt \/kein\/chrome; dort gibt es auf diesem Rechner keinen ausführbaren Browser\. Ein Arbeitsplatz holt Chromium mit pnpm provision --workspace/);

  const executor = executorWith({});
  await assert.rejects(executor.execute("eins", BROWSER_OPERATIONS.open, { url: "http://localhost/", viewport }), /kein Host bekannt/);
  await executor.shutdown();
});

test("das Paket lädt playwright-core nie beim Import, nur als Typ", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
  const files = (await readdir(root, { recursive: true })).filter((file) => file.endsWith(".ts"));
  const imports = await Promise.all(files.map(async (file) => {
    const source = await readFile(path.join(root, file), "utf8");
    return [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"playwright-core";/gm)].map((match) => ({ file, typeOnly: match[1] !== undefined }));
  }));
  const found = imports.flat();
  assert.ok(found.length > 0);
  assert.deepEqual(found.filter((entry) => !entry.typeOnly), []);
});
