import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { provisioned } from "../src/config-definition.ts";
import { resolvePluginEntries, type ResolvedPlugin } from "../src/profile/plugin-discovery.ts";
import { provisionPlugins, provisionReportLine } from "../src/profile/provisioning.ts";
import { createFsharpProvision, FSAUTOCOMPLETE_VERSION } from "../../../plugins/ragents.lsp-fsharp/provision.ts";
import { createRoslynProvision, ROSLYN_VERSION } from "../../../plugins/ragents.lsp-roslyn/provision.ts";
import { PLUGIN_ENTRY_SOURCE, writeBundle } from "./bundle-fixture.ts";

const workspace = async (t: TestContext): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-provision-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

const zipEntry = (name: string, content: Buffer, offset: number): { local: Buffer; central: Buffer } => {
  const nameBytes = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30 + nameBytes.byteLength + content.byteLength);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(content.byteLength, 18);
  local.writeUInt32LE(content.byteLength, 22);
  local.writeUInt16LE(nameBytes.byteLength, 26);
  nameBytes.copy(local, 30);
  content.copy(local, 30 + nameBytes.byteLength);
  const central = Buffer.alloc(46 + nameBytes.byteLength);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(content.byteLength, 20);
  central.writeUInt32LE(content.byteLength, 24);
  central.writeUInt16LE(nameBytes.byteLength, 28);
  central.writeUInt32LE(offset, 42);
  nameBytes.copy(central, 46);
  return { local, central };
};

/** A ZIP without compression, so that the test needs no network and no third-party library. */
const zipOf = (files: Readonly<Record<string, string>>): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const entry = zipEntry(name, Buffer.from(text, "utf8"), offset);
    locals.push(entry.local);
    centrals.push(entry.central);
    offset += entry.local.byteLength;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
};

const roslynArchive = zipOf({
  "content/LanguageServer/neutral/Microsoft.CodeAnalysis.LanguageServer.dll": "roslyn",
  "content/LanguageServer/neutral/Resources/de/Server.resources.dll": "translated",
  "_rels/.rels": "not in the tool folder",
});

const fsharpArchive = zipOf({
  "tools/net8.0/any/fsautocomplete.dll": "fsac net8",
  "tools/net9.0/any/fsautocomplete.dll": "fsac net9",
  "tools/net9.0/any/runtimes/win/lib/net8.0/System.Management.dll": "fsac net9 runtime",
  "tools/net10.0/any/fsautocomplete.dll": "fsac net10",
});

const counting = (archive: Buffer) => {
  const calls: string[] = [];
  return { calls, download: async (url: string): Promise<Buffer> => { calls.push(url); return archive; } };
};

const listing = async (directory: string): Promise<readonly string[]> =>
  (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .sort();

test("Roslyn is downloaded once; afterwards check reports ready and a second apply changes nothing", async (t) => {
  const target = await workspace(t);
  const { calls, download } = counting(roslynArchive);
  const provision = createRoslynProvision(download, async () => [10]);

  const before = await provision.check(target);
  assert.equal(before.kind === "gap" && before.installable, true);
  await provision.apply(target, () => undefined);
  assert.deepEqual(await provision.check(target), { kind: "ready" });
  const first = await listing(target);
  await provision.apply(target, () => undefined);

  assert.equal(calls.length, 1);
  assert.deepEqual(await provision.check(target), { kind: "ready" });
  assert.deepEqual(await listing(target), first);
  assert.deepEqual(first, [
    "provisioned.json",
    path.join("roslyn", "Microsoft.CodeAnalysis.LanguageServer.dll"),
    path.join("roslyn", "Resources", "de", "Server.resources.dll"),
  ]);
  assert.equal(JSON.parse(await readFile(path.join(target, "provisioned.json"), "utf8")).version, ROSLYN_VERSION);
});

test("a different pinned version in the tool folder is a gap that apply closes", async (t) => {
  const target = await workspace(t);
  const provision = createRoslynProvision(counting(roslynArchive).download, async () => [10]);
  await provision.apply(target, () => undefined);
  await writeFile(path.join(target, "provisioned.json"), JSON.stringify({ version: "0.0.0-old" }));

  const state = await provision.check(target);

  assert.equal(state.kind === "gap" && state.name, "roslyn");
  assert.equal(state.kind === "gap" && state.installable, true);
  await provision.apply(target, () => undefined);
  assert.deepEqual(await provision.check(target), { kind: "ready" });
});

test("without dotnet check names a gap that apply must not close", async (t) => {
  const target = await workspace(t);
  const provision = createRoslynProvision(async () => { throw new Error("must not download"); }, async () => undefined);

  const state = await provision.check(target);

  assert.equal(state.kind === "gap" && state.name, "dotnet");
  assert.equal(state.kind === "gap" && state.installable, false);
  await assert.rejects(() => provision.apply(target, () => undefined), /dotnet is missing on this machine/);
  assert.deepEqual(await listing(target), []);
});

test("fsautocomplete takes the highest target framework available on this machine", async (t) => {
  const target = await workspace(t);
  const provision = createFsharpProvision(counting(fsharpArchive).download, async () => [8, 9]);

  await provision.apply(target, () => undefined);

  assert.deepEqual(await provision.check(target), { kind: "ready" });
  assert.equal(await readFile(path.join(target, "fsautocomplete", "fsautocomplete.dll"), "utf8"), "fsac net9");
  assert.deepEqual(await listing(target), [
    path.join("fsautocomplete", "fsautocomplete.dll"),
    path.join("fsautocomplete", "runtimes", "win", "lib", "net8.0", "System.Management.dll"),
    "provisioned.json",
  ]);
  assert.equal(JSON.parse(await readFile(path.join(target, "provisioned.json"), "utf8")).version, FSAUTOCOMPLETE_VERSION);
});

test("if no target framework matches the runtime, the error names both sides", async (t) => {
  const target = await workspace(t);
  const provision = createFsharpProvision(counting(fsharpArchive).download, async () => [6]);

  await assert.rejects(() => provision.apply(target, () => undefined), /only ships net8\.0, net9\.0, net10\.0; the installed \.NET runtimes are 6/);
});

const fakePlugin = (root: string, id: string, provision: string | undefined): ResolvedPlugin => {
  const folder = writeBundle(path.join(root, id), { server: `${provision ?? ""}${PLUGIN_ENTRY_SOURCE}` });
  return resolvePluginEntries([folder])[0]!;
};

const installing = `import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
export const provision = {
  check: async (target) => (await stat(path.join(target, "tool")).catch(() => undefined))?.isFile()
    ? { kind: "ready" }
    : { kind: "gap", name: "tool", instruction: "the tool is missing", installable: true },
  apply: async (target, log) => {
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "tool"), "here");
    log("tool written");
  },
};
`;

const blocked = `export const provision = {
  check: async () => ({ kind: "gap", name: "dotnet", instruction: "install dotnet", installable: false }),
  apply: async () => { throw new Error("must not run"); },
};
`;

test("the report names ready, installed or missing per plugin and skips plugins without provisioning", async (t) => {
  const root = await workspace(t);
  const data = path.join(root, "data");
  const plugins = [
    fakePlugin(root, "test.installs", installing),
    fakePlugin(root, "test.blocked", blocked),
    fakePlugin(root, "test.plain", undefined),
  ];
  const lines: string[] = [];

  const first = await provisionPlugins(plugins, data, (line) => lines.push(line));
  const second = await provisionPlugins(plugins, data, () => undefined);

  assert.deepEqual(first.map((report) => [report.id, report.outcome]), [["test.installs", "installed"], ["test.blocked", "missing"]]);
  assert.deepEqual(second.map((report) => [report.id, report.outcome]), [["test.installs", "ready"], ["test.blocked", "missing"]]);
  assert.equal(first[0]!.target, path.join(data, "tools", "test.installs"));
  assert.deepEqual(lines, ["   tool written", "test.installs: installed", "test.blocked: missing: install dotnet"]);
  assert.equal(provisionReportLine(second[1]!), "test.blocked: missing: install dotnet");
});

test("provisioned names plugin and file and rejects escapes from the tool folder", () => {
  assert.deepEqual(provisioned("ragents.lsp-roslyn", "roslyn/Microsoft.CodeAnalysis.LanguageServer.dll"),
    { kind: "provisioned", plugin: "ragents.lsp-roslyn", path: "roslyn/Microsoft.CodeAnalysis.LanguageServer.dll" });
  for (const plugin of ["", "Ragents.Lsp", "../other", "ragents/lsp"]) {
    assert.throws(() => provisioned(plugin, "file"), /does not name a valid plugin id/, plugin);
  }
  for (const file of ["", "/absolute", "../outside", "roslyn//server", "roslyn/./server"]) {
    assert.throws(() => provisioned("ragents.lsp-roslyn", file), /relative path in the tool folder/, file);
  }
});

test("provisioned becomes the path in the tool folder of the data folder when the profile file loads", async (t) => {
  const root = await workspace(t);
  const data = path.join(root, "data");
  await writeFile(path.join(root, "ragents.config.test-provisioned.ts"), `const provisioned = (plugin, file) => ({ kind: "provisioned", plugin, path: file });
export const config = {
  host: { DATA_DIR: ${JSON.stringify(data)} },
  "ragents.lsp-roslyn": { ROSLYN_LANGUAGE_SERVER: provisioned("ragents.lsp-roslyn", "roslyn/Microsoft.CodeAnalysis.LanguageServer.dll") },
};
`);
  process.env.PRODUCT_PROFILE = "test-provisioned";
  delete process.env.DATA_DIR;
  delete process.env.ROSLYN_LANGUAGE_SERVER;

  const { loadConfigFile } = await import("../src/config-file.ts");
  await loadConfigFile(root);

  assert.equal(process.env.ROSLYN_LANGUAGE_SERVER,
    path.join(data, "tools", "ragents.lsp-roslyn", "roslyn", "Microsoft.CodeAnalysis.LanguageServer.dll"));
});
