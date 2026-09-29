import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { selectedProfile } from "./run-provision.ts";

test("a profile path applies from the caller, a name next to the host", async (t) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-provision-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const host = path.join(directory, "host");
  const caller = path.join(directory, "project");
  mkdirSync(host);
  mkdirSync(caller);
  writeFileSync(path.join(host, "ragents.config.core.ts"), "export const config = { host: {} };\n");
  writeFileSync(path.join(caller, "ragents.config.own.ts"), "export const config = { host: {} };\n");

  assert.deepEqual(selectedProfile("./ragents.config.own.ts", host, caller), { profile: "own", file: path.join(caller, "ragents.config.own.ts") });
  assert.deepEqual(selectedProfile("core", host, caller), { profile: "core", file: path.join(host, "ragents.config.core.ts") });
  assert.throws(() => selectedProfile("missing", host, caller), /Configuration is missing: .*ragents\.config\.missing\.ts/);
  assert.throws(() => selectedProfile("./ragents.config.core.ts", host, caller), /The profile file is missing/);
});
