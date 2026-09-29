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
  launch: async () => { throw new Error("startet nicht"); }, open: async () => "offen",
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

test("ein Beitrag lädt als Datei, sein Stand ist der SHA-256 ihres Inhalts, und ein neuer Inhalt kommt nie aus dem Modulcache", async () => {
  await withFolder(async (folder) => {
    const file = path.join(folder, "index.mjs");
    const first = `export const executor = (machine) => ({ languageServers: [{ ...${adapterSource}, label: machine.toolsDirectory }] });\n`;
    await writeFile(file, first);
    const one = await loadExecutorContribution("acme.demo", file);
    assert.equal(one.plugin, "acme.demo");
    assert.equal(one.stand, createHash("sha256").update(first).digest("hex"));
    assert.equal(prepareExecutorContribution(one, "/tools/acme.demo").parts.languageServers?.[0]?.label, "/tools/acme.demo");
    await writeFile(file, first.replace("label: machine.toolsDirectory", "label: \"neu\""));
    const two = await loadExecutorContribution("acme.demo", file);
    assert.notEqual(two.stand, one.stand);
    assert.equal(prepareExecutorContribution(two, "/tools").parts.languageServers?.[0]?.label, "neu");
    assert.equal((await loadExecutorContribution("acme.demo", file, two.stand)).stand, two.stand);
  });
});

test("fehlt die Datei, hat sie einen anderen Stand oder exportiert sie keinen Beitrag, scheitert das Laden mit Ursache", async () => {
  await withFolder(async (folder) => {
    await assert.rejects(loadExecutorContribution("acme.demo", path.join(folder, "fehlt.mjs")), /Der Executor-Beitrag von acme\.demo fehlt unter .*fehlt\.mjs/);
    const throwing = path.join(folder, "wirft.mjs");
    await writeFile(throwing, "throw new Error(\"geladen\");\nexport const executor = () => ({});\n");
    await assert.rejects(loadExecutorContribution("acme.demo", throwing, "a".repeat(64)), /hat den Stand [0-9a-f]{12}, verlangt ist aaaaaaaaaaaa/);
    await assert.rejects(loadExecutorContribution("acme.demo", throwing), /Der Executor-Beitrag von acme\.demo .* lädt nicht: geladen/);
    const without = path.join(folder, "ohne.mjs");
    await writeFile(without, "export const plugin = {};\n");
    await assert.rejects(loadExecutorContribution("acme.demo", without), /Das Bundle acme\.demo exportiert in .*ohne\.mjs keinen gültigen Executor-Beitrag/);
    const notFunction = path.join(folder, "objekt.mjs");
    await writeFile(notFunction, "export const executor = { languageServers: [] };\n");
    await assert.rejects(loadExecutorContribution("acme.demo", notFunction), /keinen gültigen Executor-Beitrag; erwartet wird "export const executor: WorkspaceExecutorContribution"/);
  });
});

test("was ein Beitrag liefert, prüft die Maschine; eine falsche Form ist ein Fehler, der das Plugin nennt", () => {
  const invalid = (parts: unknown) => () => prepareExecutorContribution(loaded(() => parts as never), "/tools");
  assert.throws(invalid(null), /Der Executor-Beitrag von acme\.demo ist ungültig: die Funktion liefert kein Objekt/);
  assert.throws(() => prepareExecutorContribution(loaded(() => { throw new Error("kaputt"); }), "/tools"), /acme\.demo ist ungültig: die Funktion wirft: kaputt/);
  assert.throws(invalid({ shell: [] }), /unbekannte Teile shell; erlaubt sind languageServers, modules/);
  assert.throws(invalid({ modules: ["modul"] }), /modules ist keine Liste von Modulfabriken/);
  assert.throws(invalid({ languageServers: {} }), /languageServers ist keine Liste/);
  assert.throws(invalid({ languageServers: ["roh"] }), /der Sprachserver 1 ist kein Objekt/);
  assert.throws(invalid({ languageServers: [{ id: "Demo Server", label: "x", languages: {}, rootDescription: "x" }] }),
    /der Sprachserver 1 braucht id aus Kleinbuchstaben und Ziffern, resolveRoot, rootDirectory, launch, open/);
  const machines: string[] = [];
  const prepared = prepareExecutorContribution(loaded((machine) => {
    machines.push(machine.toolsDirectory);
    return {};
  }), "/tools/acme.demo");
  assert.deepEqual(prepared, { plugin: "acme.demo", stand: "0".repeat(64), parts: {} });
  assert.deepEqual(machines, ["/tools/acme.demo"]);
});

test("die Maschine löst Dateien aus den Paketen ihres Hosts auf und nennt die Ursache, wenn Host oder Paket fehlen", () => {
  const machine = executorMachine("/tools");
  const hostRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  assert.match(machine.hostPackageFile(hostRoot, "typescript-language-server/lib/cli.mjs"), /typescript-language-server[/\\]lib[/\\]cli\.mjs$/);
  assert.throws(() => machine.hostPackageFile(undefined, "typescript-language-server/lib/cli.mjs"),
    /Auf diesem Rechner ist kein Host bekannt, aus dem sich typescript-language-server auflösen ließe/);
  assert.throws(() => machine.hostPackageFile(path.join(tmpdir(), "kein-host-hier"), "@acme/fehlt/datei.js"), /@acme\/fehlt liegt nicht im Host/);
});
