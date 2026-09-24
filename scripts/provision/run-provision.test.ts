import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { selectedProfile } from "./run-provision.ts";

test("ein Profilpfad gilt ab dem Aufrufer, ein Name neben dem Host", async (t) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-provision-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const host = path.join(directory, "host");
  const caller = path.join(directory, "projekt");
  mkdirSync(host);
  mkdirSync(caller);
  writeFileSync(path.join(host, "ragents.config.core.ts"), "export const config = { host: {} };\n");
  writeFileSync(path.join(caller, "ragents.config.eigen.ts"), "export const config = { host: {} };\n");

  assert.deepEqual(selectedProfile("./ragents.config.eigen.ts", host, caller), { profile: "eigen", file: path.join(caller, "ragents.config.eigen.ts") });
  assert.deepEqual(selectedProfile("core", host, caller), { profile: "core", file: path.join(host, "ragents.config.core.ts") });
  assert.throws(() => selectedProfile("fehlt", host, caller), /Konfiguration fehlt: .*ragents\.config\.fehlt\.ts/);
  assert.throws(() => selectedProfile("./ragents.config.core.ts", host, caller), /Die Profildatei fehlt/);
});
