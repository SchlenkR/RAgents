import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { OperationContributionRegistry } from "@aicontainer/ragents";
import { setupRun } from "../../../packages/ragents/tests/support.ts";
import { runtimeFor, writeAppFiles } from "./actor-runtime-fixture.ts";

test("native project checks use exact capability types and file tests use explicit mocks", async (t) => {
  const setup = setupRun();
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-mini-app-contracts-"));
  const operations = new OperationContributionRegistry();
  let calls = 0;
  operations.register("demo", [{ id: "demo_echo", label: "Echo", description: "Repeat text", schema: Type.Object({ text: Type.String() }),
    resultSchema: Type.Object({ echoed: Type.String() }, { additionalProperties: false }), operator: "direct", execute: () => { calls++; return { echoed: "real" }; } }]);
  const runtime = runtimeFor(setup, directory, operations);
  t.after(async () => { await runtime.shutdown(); await rm(directory, { recursive: true, force: true }); });
  const appDirectory = await writeAppFiles(directory, "contracts", {
    "package.json": JSON.stringify({ name: "contracts", private: true, type: "module", ragents: { title: "Contracts", views:[{id:"main",client:"src/client.tsx"}], backend: "src/server.ts" } }),
    "src/client.tsx": "export {};",
    "src/server.ts": `import {Type} from "typebox"; import {defineActor} from "@ragents/server";
export default defineActor({state:Type.Object({}),functions:{echo:{label:"Echo",input:Type.Object({text:Type.String()}),output:Type.String(),capabilities:["demo_echo"]}}}, {functions:{
 echo:async(input,context)=>(await context.functions.demo_echo({text:input.text})).echoed
}});`,
    "tests/echo.test.ts": `import test from "node:test"; import assert from "node:assert/strict";
import app from "../src/server.ts"; import {createTestContext} from "@ragents/server/testing";
test("echo uses its declared operation", async()=>{
 const context=createTestContext({state:{},functions:{demo_echo:input=>({echoed:(input as {text:string}).text})}});
 assert.equal(await app.functions.echo({text:"mock"},context),"mock");
});`,
  });
  const context = { actorId: setup.view.ownerId, commandId: "activate" };
  assert.deepEqual(await runtime.activate(context, setup.view.id, "contracts"), { name: "contracts", actor: "@contracts", views: 1, active: true });
  assert.equal(calls, 0);
  const file = path.join(appDirectory, "src/server.ts");
  const source = await readFile(file, "utf8");
  await writeFile(file, source.replace("text:input.text", "text:123"));
  await assert.rejects(runtime.check(setup.view.id, "contracts", setup.view.ownerId), /number.*string/s);
  await writeFile(file, source.replace(").echoed", ").missing"));
  await assert.rejects(runtime.check(setup.view.id, "contracts", setup.view.ownerId), /missing.*exist/s);
  assert.equal(calls, 0);
});
