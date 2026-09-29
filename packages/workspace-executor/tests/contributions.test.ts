import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  executorMachine,
  loadExecutorContribution,
  prepareExecutorContribution,
  type LoadedExecutorContribution,
  type WorkspaceExecutorContribution,
} from "../src/index.ts";

const adapterSource = `{
  id: "demo", label: "Demo", languages: { ".demo": "demo" }, rootDescription: "directory",
  resolveRoot: machine.resolveRootDirectory, rootDirectory: (root) => root,
  launch: async () => { throw new Error("does not start"); }, open: async () => "open",
}`;

const withFolder = async (use: (folder: string) => Promise<void>): Promise<void> => {
  const folder = await mkdtemp(path.join(tmpdir(), "ragents-contribution-"));
  try {
    await use(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
};

const loaded = (contribution: WorkspaceExecutorContribution): LoadedExecutorContribution => ({ plugin: "acme.demo", stand: "0".repeat(64), contribution });

test("a contribution loads as a file, its version is the SHA-256 of its content, and new content never comes from the module cache", async () => {
  await withFolder(async (folder) => {
    const file = path.join(folder, "index.mjs");
    const first = `export const executor = (machine) => ({ languageServers: [{ ...${adapterSource}, label: machine.toolsDirectory }] });\n`;
    await writeFile(file, first);
    const one = await loadExecutorContribution("acme.demo", file);
    assert.equal(one.plugin, "acme.demo");
    assert.equal(one.stand, createHash("sha256").update(first).digest("hex"));
    assert.equal(prepareExecutorContribution(one, "/tools/acme.demo").parts.languageServers?.[0]?.label, "/tools/acme.demo");
    await writeFile(file, first.replace("label: machine.toolsDirectory", "label: \"new\""));
    const two = await loadExecutorContribution("acme.demo", file);
    assert.notEqual(two.stand, one.stand);
    assert.equal(prepareExecutorContribution(two, "/tools").parts.languageServers?.[0]?.label, "new");
    assert.equal((await loadExecutorContribution("acme.demo", file, two.stand)).stand, two.stand);
  });
});

test("if the file is missing, has another version or exports no contribution, loading fails with a cause", async () => {
  await withFolder(async (folder) => {
    await assert.rejects(loadExecutorContribution("acme.demo", path.join(folder, "missing.mjs")), /The executor contribution of acme\.demo is missing at .*missing\.mjs/);
    const throwing = path.join(folder, "throws.mjs");
    await writeFile(throwing, "throw new Error(\"loaded\");\nexport const executor = () => ({});\n");
    await assert.rejects(loadExecutorContribution("acme.demo", throwing, "a".repeat(64)), /has the version [0-9a-f]{12}, required is aaaaaaaaaaaa/);
    await assert.rejects(loadExecutorContribution("acme.demo", throwing), /The executor contribution of acme\.demo .* does not load: loaded/);
    const without = path.join(folder, "without.mjs");
    await writeFile(without, "export const plugin = {};\n");
    await assert.rejects(loadExecutorContribution("acme.demo", without), /The bundle acme\.demo exports no valid executor contribution in .*without\.mjs/);
    const notFunction = path.join(folder, "object.mjs");
    await writeFile(notFunction, "export const executor = { languageServers: [] };\n");
    await assert.rejects(loadExecutorContribution("acme.demo", notFunction), /no valid executor contribution in .*; expected is "export const executor: WorkspaceExecutorContribution"/);
  });
});

test("the machine checks what a contribution returns; a wrong shape is an error that names the plugin", () => {
  const invalid = (parts: unknown) => () => prepareExecutorContribution(loaded(() => parts as never), "/tools");
  assert.throws(invalid(null), /The executor contribution of acme\.demo is invalid: the function returns no object/);
  assert.throws(() => prepareExecutorContribution(loaded(() => { throw new Error("broken"); }), "/tools"), /acme\.demo is invalid: the function throws: broken/);
  assert.throws(invalid({ shell: [] }), /unknown parts shell; allowed are languageServers, modules/);
  assert.throws(invalid({ modules: ["module"] }), /modules is not a list of module factories/);
  assert.throws(invalid({ languageServers: {} }), /languageServers is not a list/);
  assert.throws(invalid({ languageServers: ["raw"] }), /the language server 1 is not an object/);
  assert.throws(invalid({ languageServers: [{ id: "Demo Server", label: "x", languages: {}, rootDescription: "x" }] }),
    /the language server 1 needs id of lowercase letters and digits, resolveRoot, rootDirectory, launch, open/);
  const machines: string[] = [];
  const prepared = prepareExecutorContribution(loaded((machine) => {
    machines.push(machine.toolsDirectory);
    return {};
  }), "/tools/acme.demo");
  assert.deepEqual(prepared, { plugin: "acme.demo", stand: "0".repeat(64), parts: {} });
  assert.deepEqual(machines, ["/tools/acme.demo"]);
});

test("the machine resolves files from the packages of its host and names the cause if host or package are missing", () => {
  const machine = executorMachine("/tools");
  const hostRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  assert.match(machine.hostPackageFile(hostRoot, "typescript-language-server/lib/cli.mjs"), /typescript-language-server[/\\]lib[/\\]cli\.mjs$/);
  assert.throws(() => machine.hostPackageFile(undefined, "typescript-language-server/lib/cli.mjs"),
    /No host is known on this machine from which typescript-language-server could be resolved/);
  assert.throws(() => machine.hostPackageFile(path.join(tmpdir(), "no-host-here"), "@acme/missing/file.js"), /@acme\/missing is not in the host/);
});
