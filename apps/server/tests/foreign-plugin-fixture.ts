import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

/** A plugin as a foreign author writes it: a method on the server, types of the agent runtime, a web half with state, a bundled icon and its own class. */
export const GREETING_PLUGIN: Readonly<Record<string, string>> = {
  "ragents-plugin.json": JSON.stringify({ id: "acme.greeting" }),
  "server/index.ts": `import { Type } from "typebox";
import { implement } from "@ragents/engine";
import { defineOperation } from "@ragents/engine/src/rpc/contract";
import type { ModelUpstream } from "@ragents/host/plugin-support/model-upstreams.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
export type Catalog = readonly ModelUpstream["models"][number][];
const hello = defineOperation({
  id: "acme.greeting.hello",
  description: "Grüßt aus dem Bundle.",
  rights: [],
  input: Type.Object({}),
  result: Type.Object({ text: Type.String() }),
});
export const plugin: PluginModule = {
  create: () => ({ manifest: { id: "acme.greeting" }, register: (host) => { host.methods(implement(hello, () => ({ text: "Hallo aus dem Bundle" }))); } }),
};
`,
  "web/index.tsx": `import { useState } from "react";
import { Check } from "lucide-react";
import { Badge } from "@ragents/web/ui";
import type { WebPlugin } from "@ragents/web/PluginRegistry";
export const Greeting = () => {
  const [open, setOpen] = useState(false);
  return <Badge className="bg-[#0b5f4a]" onClick={() => setOpen(!open)}><Check />{open ? "auf" : "zu"}</Badge>;
};
export const webPlugin: WebPlugin = { id: "acme.greeting" };
`,
};

/** The class of the greeting plugin as it stands in the compiled stylesheet. */
export const GREETING_CLASS = /bg-\\\[\\#0b5f4a\\\]/;

export const writeFiles = (folder: string, files: Readonly<Record<string, string>>): string => {
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
    writeFileSync(path.join(folder, name), content);
  }
  return folder;
};

/** A profile file with the neutral plugins a product needs and a model key from the environment. */
export const profileSource = (name: string, plugins: readonly string[], extra = ""): string => `import { env } from "@ragents/host/config-definition.js";
export const config = {
  host: { PORT: 4790, PRODUCT_PROFILE: ${JSON.stringify(name)}, PRODUCT_ID: "acme", PRODUCT_TITLE: "Acme", PLUGINS: ${JSON.stringify(plugins)} },
  "ragents.product": { OPENROUTER_API_KEY: env("ACME_MODEL_KEY"), AGENT_MODEL: "z-ai/glm-5.3-flash", AGENT_COORDINATOR_MODEL: "z-ai/glm-5.3-flash" },
  ${extra}
};
`;

/** Data folders may lie in no project; the temp folder of a Mac sometimes carries a foreign package.json above it. */
export const isolatedDirectory = (prefix: string): string =>
  mkdtempSync(path.join(process.platform === "darwin" ? "/private/tmp" : tmpdir(), prefix));

export interface Announced {
  readonly url: string;
  readonly token: string;
}

/** Waits for the announcement of a host started with --port 0; its console goes to stderr, the announcement to stdout. */
export const announcement = (child: ChildProcess, output: string[]): Promise<Announced> => new Promise((resolve, reject) => {
  createInterface({ input: child.stderr! }).on("line", (line) => output.push(line));
  createInterface({ input: child.stdout! }).on("line", (line) => {
    output.push(line);
    if (line.startsWith("{\"ragents\"")) resolve((JSON.parse(line) as { ragents: Announced }).ragents);
  });
  child.once("exit", (code) => reject(new Error(`Der Prozess endete mit ${code} vor seiner Ansage:\n${output.slice(-25).join("\n")}`)));
});

export const stopChild = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await exited;
};

export const rpc = async (host: Announced, method: string): Promise<unknown> => {
  const response = await fetch(`${host.url}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${host.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }),
  });
  const body = await response.json() as { result?: unknown; error?: unknown };
  assert.equal(body.error, undefined, `${method}: ${JSON.stringify(body.error)}`);
  return body.result;
};

/** What a started host must show of the greeting bundle: its method, its web half, its class, and the web of that host. */
export const assertGreetingServed = async (host: Announced, webDirectory: string): Promise<void> => {
  const bootstrap = await rpc(host, "ragents.plugins.bootstrap") as { plugins: { id: string; web?: { entry: string } }[] };
  const entryAddress = bootstrap.plugins.find((plugin) => plugin.id === "acme.greeting")?.web?.entry;
  assert.equal(entryAddress, "/plugins/acme.greeting/web/index.js");
  assert.deepEqual(await rpc(host, "acme.greeting.hello"), { text: "Hallo aus dem Bundle" }, "die Server-Hälfte läuft");
  const entry = await fetch(`${host.url}${entryAddress}`);
  assert.equal(entry.status, 200, "die Web-Hälfte lädt ohne Token, wie in einem iframe ohne Cookie");
  assert.match(await entry.text(), /webPlugin/);
  assert.equal((await fetch(`${host.url}${entryAddress}.map`)).status, 401, "die Sourcemap trägt den Quelltext und bleibt hinter dem Token");
  assert.equal((await fetch(`${host.url}${entryAddress}.map`, { headers: { authorization: `Bearer ${host.token}` } })).status, 200);
  assert.equal((await fetch(`${host.url}/plugins/acme.greeting/api/anything`)).status, 401, "frei ist nur die Web-Hälfte, nicht alles unter /plugins/");
  assert.match(await (await fetch(`${host.url}/ragents.css`)).text(), GREETING_CLASS, "die Klassen des Bundles gehen ins Stylesheet des Hosts");
  assert.equal(await (await fetch(`${host.url}/?access=${host.token}`)).text(), readFileSync(path.join(webDirectory, "index.html"), "utf8"),
    "das Web kommt fertig aus dem Host");
};
