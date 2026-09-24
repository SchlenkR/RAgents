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

/** Ein ZIP ohne Kompression, damit der Test kein Netz und keine fremde Bibliothek braucht. */
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
  "content/LanguageServer/neutral/Ressourcen/de/Server.resources.dll": "übersetzt",
  "_rels/.rels": "nicht im Werkzeugordner",
});

const fsharpArchive = zipOf({
  "tools/net8.0/any/fsautocomplete.dll": "fsac net8",
  "tools/net9.0/any/fsautocomplete.dll": "fsac net9",
  "tools/net9.0/any/runtimes/win/lib/net8.0/System.Management.dll": "fsac net9 laufzeit",
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

test("Roslyn wird einmal geladen; danach meldet check bereit und ein zweites apply ändert nichts", async (t) => {
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
    path.join("roslyn", "Ressourcen", "de", "Server.resources.dll"),
  ]);
  assert.equal(JSON.parse(await readFile(path.join(target, "provisioned.json"), "utf8")).version, ROSLYN_VERSION);
});

test("eine andere gepinnte Fassung im Werkzeugordner ist eine Lücke, die apply schließt", async (t) => {
  const target = await workspace(t);
  const provision = createRoslynProvision(counting(roslynArchive).download, async () => [10]);
  await provision.apply(target, () => undefined);
  await writeFile(path.join(target, "provisioned.json"), JSON.stringify({ version: "0.0.0-alt" }));

  const state = await provision.check(target);

  assert.equal(state.kind === "gap" && state.name, "roslyn");
  assert.equal(state.kind === "gap" && state.installable, true);
  await provision.apply(target, () => undefined);
  assert.deepEqual(await provision.check(target), { kind: "ready" });
});

test("ohne dotnet nennt check eine Lücke, die apply nicht schließen darf", async (t) => {
  const target = await workspace(t);
  const provision = createRoslynProvision(async () => { throw new Error("darf nicht laden"); }, async () => undefined);

  const state = await provision.check(target);

  assert.equal(state.kind === "gap" && state.name, "dotnet");
  assert.equal(state.kind === "gap" && state.installable, false);
  await assert.rejects(() => provision.apply(target, () => undefined), /dotnet fehlt auf diesem Rechner/);
  assert.deepEqual(await listing(target), []);
});

test("fsautocomplete nimmt die höchste Zielplattform, die es auf diesem Rechner gibt", async (t) => {
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

test("passt keine Zielplattform zur Laufzeit, nennt der Fehler beide Seiten", async (t) => {
  const target = await workspace(t);
  const provision = createFsharpProvision(counting(fsharpArchive).download, async () => [6]);

  await assert.rejects(() => provision.apply(target, () => undefined), /bringt nur net8\.0, net9\.0, net10\.0 mit; installiert sind die \.NET-Laufzeiten 6/);
});

const fakePlugin = (root: string, id: string, provision: string | undefined): ResolvedPlugin => {
  const folder = writeBundle(path.join(root, id), { server: `${provision ?? ""}${PLUGIN_ENTRY_SOURCE}` });
  return resolvePluginEntries([folder])[0]!;
};

const installing = `import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
export const provision = {
  check: async (target) => (await stat(path.join(target, "werkzeug")).catch(() => undefined))?.isFile()
    ? { kind: "ready" }
    : { kind: "gap", name: "werkzeug", instruction: "das Werkzeug fehlt", installable: true },
  apply: async (target, log) => {
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "werkzeug"), "da");
    log("Werkzeug geschrieben");
  },
};
`;

const blocked = `export const provision = {
  check: async () => ({ kind: "gap", name: "dotnet", instruction: "dotnet installieren", installable: false }),
  apply: async () => { throw new Error("darf nicht laufen"); },
};
`;

test("der Bericht nennt je Plugin bereit, installiert oder fehlt und überspringt Plugins ohne Provisionierung", async (t) => {
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
  assert.deepEqual(lines, ["   Werkzeug geschrieben", "test.installs: installiert", "test.blocked: fehlt: dotnet installieren"]);
  assert.equal(provisionReportLine(second[1]!), "test.blocked: fehlt: dotnet installieren");
});

test("provisioned nennt Plugin und Datei und lehnt Ausbrüche aus dem Werkzeugordner ab", () => {
  assert.deepEqual(provisioned("ragents.lsp-roslyn", "roslyn/Microsoft.CodeAnalysis.LanguageServer.dll"),
    { kind: "provisioned", plugin: "ragents.lsp-roslyn", path: "roslyn/Microsoft.CodeAnalysis.LanguageServer.dll" });
  for (const plugin of ["", "Ragents.Lsp", "../anderes", "ragents/lsp"]) {
    assert.throws(() => provisioned(plugin, "datei"), /keine gültige Plugin-Kennung/, plugin);
  }
  for (const file of ["", "/absolut", "../hinaus", "roslyn//server", "roslyn/./server"]) {
    assert.throws(() => provisioned("ragents.lsp-roslyn", file), /relativen Pfad im Werkzeugordner/, file);
  }
});

test("provisioned wird beim Laden der Profildatei zum Pfad im Werkzeugordner des Datenordners", async (t) => {
  const root = await workspace(t);
  const data = path.join(root, "daten");
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
