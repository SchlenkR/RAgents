import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { createAccessContext, defineChannel, defineOperation, implement, implementChannel, PluginHost, RPC_REQUEST_TIMEOUT_MS } from "@ragents/engine";
import { coreMethods } from "../src/api/core-methods.ts";
import { coreContracts } from "../src/api/contracts.ts";
import { coreSources, startRpcServer } from "./rpc-fixture.ts";

test("core reference works without the overseer and includes later plugin methods and channels", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-api-reference-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const host = new PluginHost({ product: { id: "acme", title: "Acme" }, dataDirectory: directory, storageModes: { sessionsRoot: 0o700, session: 0o700 } });
  const methods = coreMethods(coreSources({}, { plugins: host, authentication: { kind: "token" } }));
  host.methods.register("host", methods);
  const local = defineOperation({ id: "acme.demo.inspect", description: "Inspect the demo.", scope: "local", rights: ["runs.inspect"], timeoutMs: 40_000, input: Type.Object({ name: Type.String() }), result: Type.Object({ count: Type.Number() }) });
  const changes = defineChannel({ id: "acme.demo.changes", description: "Demo changes.", scope: "local", rights: ["runs.read"], params: Type.Object({}), message: Type.String() });
  host.methods.register("acme.demo", [implement(local, () => ({ count: 1 }))]);
  host.channels.register("acme.demo", [implementChannel(changes, () => () => undefined)]);
  const server = await startRpcServer(t, { methods });
  const reference = await server.call(coreContracts.api.reference.id, {});
  assert.equal(reference.error, undefined);
  assert.match(reference.result as string, /## ragents.api.reference/);
  assert.match(reference.result as string, /## acme.demo.inspect/);
  assert.match(reference.result as string, /Owner: acme.demo. Rights: runs.inspect. Access scope: local/);
  assert.match(reference.result as string, /Default client deadline: 40000 ms/);
  assert.match(reference.result as string, /ACCESS_TOKEN/);
  const document = (await server.call(coreContracts.api.openrpc.id, {})).result as { openrpc: string; methods: Array<Record<string, unknown>>; "x-channels": Array<Record<string, unknown>> };
  assert.equal(document.openrpc, "1.3.0");
  const method = document.methods.find((entry) => entry.name === local.id)!;
  assert.equal(method["x-owner"], "acme.demo");
  assert.equal(method["x-scope"], "local");
  assert.deepEqual(method["x-rights"], ["runs.inspect"]);
  assert.equal(method["x-timeout-ms"], 40_000);
  assert.deepEqual(method.params, [{ name: "input", required: true, schema: JSON.parse(JSON.stringify(local.input)) }]);
  assert.deepEqual(method.result, { name: "result", schema: JSON.parse(JSON.stringify(local.result)) });
  const core = document.methods.find((entry) => entry.name === coreContracts.api.reference.id)!;
  assert.equal(core["x-timeout-ms"], RPC_REQUEST_TIMEOUT_MS);
  assert.equal(core["x-scope"], "unrestricted");
  assert.deepEqual(document["x-channels"], [{ name: changes.id, description: changes.description, params: JSON.parse(JSON.stringify(changes.params)), message: JSON.parse(JSON.stringify(changes.message)), "x-owner": "acme.demo", "x-rights": ["runs.read"], "x-scope": "local" }]);
  assert.equal((await server.call(coreContracts.api.reference.id, { unknown: true })).error?.code, -32602);
});

test("core reference requires the same access as the overseer reference", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-api-reference-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const rights of [[], ["runs.read"], ["runs.inspect"]]) {
    const host = new PluginHost({ product: { id: "acme", title: "Acme" }, dataDirectory: directory, storageModes: { sessionsRoot: 0o700, session: 0o700 } });
    const server = await startRpcServer(t, {
      methods: coreMethods(coreSources({}, { plugins: host })),
      accessFor: () => createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights } }),
    });
    for (const method of [coreContracts.api.reference, coreContracts.api.openrpc]) {
      assert.deepEqual((await server.call(method.id, {})).error?.data, { code: "access-denied", status: 403 });
    }
  }
});

test("the external-access switch uses its declared local scope before changing state", async (t) => {
  const changes: boolean[] = [];
  const methods = coreMethods(coreSources({}, { external: { open: () => true, set: async (open) => { changes.push(open); } } }));
  const remote = await startRpcServer(t, { methods, local: false });
  const rejected = await remote.call(coreContracts.external.set.id, { state: "off" });
  assert.deepEqual(rejected.error?.data, { code: "local-only", status: 403 });
  assert.deepEqual(changes, []);
  const local = await startRpcServer(t, { methods, local: true });
  assert.deepEqual((await local.call(coreContracts.external.set.id, { state: "on" })).result, { external: true });
  assert.deepEqual(changes, [true]);
});
