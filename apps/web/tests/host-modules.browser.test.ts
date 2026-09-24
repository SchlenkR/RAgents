import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type Frame, type Page } from "playwright-core";
import { LIBRARY, hostApi, hostApiModules } from "../../server/src/host-api.ts";
import { hostWebDirectory, hostWebProblem } from "../../server/src/host-web.ts";
import { buildPlugins } from "../../server/src/plugin-build/build.ts";
import { readHostApiRecord, typeViews } from "../../server/src/plugin-build/host-api-names.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

const PROBE_PLUGIN: Readonly<Record<string, string>> = {
  "ragents-plugin.json": JSON.stringify({ id: "acme.probe" }),
  "server/index.ts": `import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
export const plugin: PluginModule = { create: () => ({ manifest: { id: "acme.probe" }, register: () => {} }) };
`,
  "web/probe.css": ".acme-probe-outline { outline: 3px dashed; }\n",
  "web/index.tsx": `import "./probe.css";
import { useState } from "react";
import { Check } from "lucide-react";
import { Badge } from "@ragents/web/ui";
import type { WebPlugin } from "@ragents/web/PluginRegistry";
export const ProbeBadge = () => {
  const [open, setOpen] = useState(false);
  return <Badge className="acme-probe-outline bg-[#0b5f4a]" data-probe={open ? "auf" : "zu"} onClick={() => setOpen(!open)}><Check />{open ? "auf" : "zu"}</Badge>;
};
export const webPlugin: WebPlugin = { id: "acme.probe", overviewPanels: [{ id: "acme.probe", order: 99, placement: "toolbar", Panel: ProbeBadge }] };
`,
};

/** A web half that fails while loading; the interface must stay and name it. */
const BROKEN_PLUGIN: Readonly<Record<string, string>> = {
  "ragents-plugin.json": JSON.stringify({ id: "acme.broken" }),
  "server/index.ts": `import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
export const plugin: PluginModule = { create: () => ({ manifest: { id: "acme.broken" }, register: () => {} }) };
`,
  "web/index.ts": `throw new Error("absichtlich kaputt");\n`,
};

interface HostServer {
  readonly url: string;
  readonly token: string;
  readonly stop: () => Promise<void>;
}

/** The real host with the profile showcase plus the probe bundle, on a private port with its announced token. */
const startHost = async (directory: string, probes: readonly string[]): Promise<HostServer> => {
  const profileFile = path.join(directory, "ragents.config.browser-probe.ts");
  writeFileSync(profileFile, `import { config as showcase } from ${JSON.stringify(path.join(root, "ragents.config.showcase.ts"))};
export const config = { ...showcase, host: { ...showcase.host, PRODUCT_PROFILE: "browser-probe", PLUGINS: [...showcase.host.PLUGINS, ...${JSON.stringify(probes)}] } };
`);
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts", "--port", "0"], {
    cwd: path.join(root, "apps/server"),
    env: { ...process.env, PRODUCT_PROFILE: "browser-probe", PRODUCT_PROFILE_FILE: profileFile, DATA_DIR: path.join(directory, "data"), RAGENTS_DEV: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output: string[] = [];
  createInterface({ input: child.stderr! }).on("line", (line) => output.push(line));
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const announced = await new Promise<{ url: string; token: string }>((resolve, reject) => {
    createInterface({ input: child.stdout! }).on("line", (line) => {
      const parsed = line.startsWith("{\"ragents\"") ? JSON.parse(line) as { ragents: { url: string; token: string } } : undefined;
      if (parsed) resolve(parsed.ragents);
    });
    void exited.then(() => reject(new Error(`Der Host endete vor seiner Ansage:\n${output.slice(-15).join("\n")}`)));
  });
  return {
    ...announced,
    stop: async () => {
      if (child.exitCode === null) child.kill("SIGTERM");
      await exited;
    },
  };
};

const registerOf = (target: Page | Frame): Promise<Record<string, string[]>> =>
  target.evaluate(() => Object.fromEntries(Object.entries((globalThis as unknown as { __ragentsHostModules: Record<string, object> }).__ragentsHostModules)
    .map(([specifier, module]) => [specifier, Object.keys(module)])));

test("das gebaute Web trägt jeden Namen aus host-api.json im Register, lädt die Bundles per Adresse und färbt sie aus dem Stylesheet des Hosts", { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 180_000 }, async () => {
  const problem = hostWebProblem(hostWebDirectory(root), root, true);
  assert.equal(problem, undefined, `${problem}; vorher pnpm build:web`);
  // Der Datenordner des Hosts darf in keinem Projekt liegen; das Temp-Verzeichnis des Macs trägt manchmal eine fremde package.json.
  const directory = mkdtempSync(path.join(process.platform === "darwin" ? "/private/tmp" : tmpdir(), "ragents-host-modules-"));
  const embedding = createServer((request, response) => {
    const target = new URL(request.url ?? "/", "http://localhost").searchParams.get("src") ?? "";
    response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><html><body style="margin:0"><iframe id="frame" style="width:1000px;height:700px;border:0" src="${target}"></iframe></body></html>`);
  });
  const sources = Object.entries({ "acme.probe": PROBE_PLUGIN, "acme.broken": BROKEN_PLUGIN }).map(([id, files]) => {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(directory, "sources", id, name)), { recursive: true });
      writeFileSync(path.join(directory, "sources", id, name), content);
    }
    return path.join(directory, "sources", id);
  });
  for (const outcome of await buildPlugins(sources, { out: path.join(directory, "bundles"), typecheck: false })) {
    assert.equal(outcome.kind, "built", outcome.kind === "failed" ? outcome.problems.join("\n") : "");
  }
  const host = await startHost(directory, ["acme.probe", "acme.broken"].map((id) => path.join(directory, "bundles", id)));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    const loaded = new Set<string>();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
      else loaded.add(new URL(response.url()).pathname);
    });
    await page.goto(`${host.url}/?access=${host.token}`);
    await page.locator("link[href='/plugins/acme.probe/web/index.css']").waitFor({ state: "attached" });
    const bootstrap = await page.evaluate(async () => (await (await fetch("/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ragents.plugins.bootstrap", params: {} }),
    })).json()) as { result: { plugins: { id: string; web?: { entry: string } }[] } });
    const entries = bootstrap.result.plugins.flatMap((plugin) => plugin.web ? [plugin.web.entry] : []);
    assert.equal(entries.length, 16, "die 14 Web-Hälften des Profils showcase samt Probe und kaputter Probe");
    for (let attempt = 0; attempt < 50 && entries.some((entry) => !loaded.has(entry)); attempt += 1) await page.waitForTimeout(100);
    assert.deepEqual(entries.filter((entry) => !loaded.has(entry)), [], "das Web lädt jede Web-Hälfte über ihre Adresse");
    const failures = page.locator("[data-slot=plugin-failures]");
    await failures.waitFor();
    assert.match(await failures.innerText(), /Das Plugin acme\.broken lädt nicht[\s\S]*\/plugins\/acme\.broken\/web\/index\.js: absichtlich kaputt/, "eine kaputte Web-Hälfte ist ein Plugin-Fehler, die Oberfläche bleibt");

    const register = await registerOf(page);
    const stored = readHostApiRecord(root).web;
    assert.deepEqual(Object.keys(register).sort(), hostApiModules("web").filter((specifier) => stored[specifier]!.length > 0).sort());
    const types = typeViews("web", root);
    for (const specifier of Object.keys(register)) {
      const present = register[specifier]!;
      const missing = stored[specifier]!.filter((name) => !present.includes(name));
      assert.deepEqual(missing, [], `${specifier}: host-api.json verspricht Namen, die das Register nicht hat`);
      const listed = hostApi.web[specifier]!;
      const expected = listed === LIBRARY ? types.get(specifier)!.names.filter((name) => present.includes(name)) : [...listed].sort();
      assert.deepEqual([...stored[specifier]!], expected, `${specifier}: host-api.json weicht von der Liste oder der Schnittmenge aus Typen und Register ab`);
    }

    await page.locator("[data-probe=zu]").click();
    const badge = page.locator("[data-probe=auf]");
    await badge.waitFor();
    assert.equal(await badge.locator("svg").count(), 1, "das gebündelte Symbol aus lucide-react rendert im React des Hosts");
    assert.equal(await badge.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(11, 95, 74)", "die Klasse aus classes.json steht im Stylesheet des Hosts");
    assert.equal(await badge.evaluate((element) => getComputedStyle(element).outlineStyle), "dashed", "das CSS der Web-Hälfte ist verlinkt");
    assert.deepEqual(errors, []);

    await new Promise<void>((resolve) => embedding.listen(0, "localhost", resolve));
    const address = embedding.address();
    assert.ok(address && typeof address === "object");
    const panel = `${host.url}/run-panel.html?host=browser&access=${host.token}`;
    const context = await browser.newContext();
    const embedded = await context.newPage();
    embedded.on("pageerror", (error) => errors.push(`Panel: ${error.message}`));
    embedded.on("response", (response) => { if (response.status() >= 400) errors.push(`Panel: ${response.status()} ${response.url()}`); });
    await embedded.goto(`http://localhost:${address.port}/?src=${encodeURIComponent(panel)}`);
    const frame = embedded.frameLocator("#frame");
    await frame.locator("link[href='/plugins/acme.probe/web/index.css']").waitFor({ state: "attached" });
    const inner = embedded.frames().find((candidate) => candidate.url().startsWith(host.url))!;
    assert.deepEqual(Object.keys(await registerOf(inner)).sort(), Object.keys(register).sort(), "das Run-Panel im fremden iframe hat dasselbe Register");
    assert.notEqual(await inner.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgba(0, 0, 0, 0)", "das Stylesheet erreicht das iframe ohne Cookie");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    embedding.close();
    await host.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
