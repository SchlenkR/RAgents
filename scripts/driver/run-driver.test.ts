import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { implement } from "@ragents/engine";
import { coreContracts } from "../../apps/server/src/api/contracts.ts";
import { startRpcServer } from "../../apps/server/tests/rpc-fixture.ts";
import { RpcClient } from "../../apps/web/src/rpc/client.ts";
import type { RunView } from "../../packages/ragents/src/domain/model.ts";
import { runContracts } from "../../packages/ragents/src/http/contracts.ts";
import { loadConfig, stopCommand } from "./run-driver.ts";

const profileIn = async (directory: string): Promise<string> => {
  const file = path.join(directory, "ragents.config.pruef.ts");
  writeFileSync(file, [
    "export const config = { host: { PORT: 4799, DATA_DIR: { kind: \"environment\", name: \"PRUEF_DATA_DIR\" } } };",
    "export const users = [{ id: \"alice\", label: \"Alice\", password: { kind: \"environment\", name: \"PRUEF_PASSWORD\" }, rights: [\"runs.read\"] }];",
    "",
  ].join("\n"));
  return file;
};

test("der Treiber löst env(...) in DATA_DIR und Passwort auf wie der Server und fällt nie still zurück", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-driver-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = await profileIn(directory);
  const base = { PRODUCT_PROFILE: "pruef", PRODUCT_PROFILE_FILE: file, RAGENTS_DRIVER_USER: "alice" };
  const data = path.join(directory, "daten");

  const config = await loadConfig({ ...base, PRUEF_DATA_DIR: data, PRUEF_PASSWORD: "geheim" });
  assert.equal(config.dataDirectory, data);
  assert.equal(config.baseUrl, "http://localhost:4799");
  assert.deepEqual(config.user, { id: "alice", password: "geheim" });

  await assert.rejects(loadConfig({ ...base, PRUEF_PASSWORD: "geheim" }), /DATA_DIR.*PRUEF_DATA_DIR/);
  await assert.rejects(loadConfig({ ...base, PRUEF_DATA_DIR: data }), /password fehlt/);
});

test("stop unterbricht nur den Turn des Primary-Actors, stop --run hält den ganzen Run an", async (t) => {
  const stopped: string[] = [];
  const interrupted: { runId: string; actorId: string }[] = [];
  const server = await startRpcServer(t, {
    methods: [
      implement(coreContracts.chat.stop, ({ runId }) => {
        stopped.push(runId);
        return null;
      }),
      implement(runContracts.view, ({ runId }) => ({ id: runId, primaryActorId: "agent_primary" }) as RunView),
      implement(runContracts.interruptTurn, ({ runId, actorId }) => {
        interrupted.push({ runId, actorId });
        return { id: runId, primaryActorId: actorId } as RunView;
      }),
    ],
  });
  const rpc = new RpcClient({ baseUrl: server.url, fetch });

  assert.match(await stopCommand(rpc, ["run-1"]), /agent_primary/);
  assert.deepEqual(interrupted, [{ runId: "run-1", actorId: "agent_primary" }]);
  assert.deepEqual(stopped, []);
  assert.match(await stopCommand(rpc, ["run-1", "--run"]), /Not-Aus/);
  assert.deepEqual(stopped, ["run-1"]);
  assert.equal(interrupted.length, 1);
  await assert.rejects(stopCommand(rpc, []), /Run-Id fehlt/);
  await assert.rejects(stopCommand(rpc, ["run-1", "--alles"]), /Unbekanntes Argument/);
});
