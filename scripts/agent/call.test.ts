import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { createAccessContext, defineOperation, DomainError, implement, PluginHost, unrestrictedAccess } from "@ragents/engine";
import { coreMethods } from "../../apps/server/src/api/core-methods.ts";
import { coreSources, startRpcServer } from "../../apps/server/tests/rpc-fixture.ts";
import { writeHostRecord } from "../../apps/server/src/host-record.ts";
import { parseArguments } from "./agent-cli.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const largeResult = { text: "Large demo output with UTF-8: äöü.\n".repeat(65_536) };

const fixture = async (t: TestContext) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-call-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const host = new PluginHost({ product: { id: "acme", title: "Acme" }, dataDirectory: directory, storageModes: { sessionsRoot: 0o700, session: 0o700 } });
  const requests: IncomingHttpHeaders[] = [];
  const demo = defineOperation({ id: "acme.demo.greet", description: "Greet the demo.\nAccept optional input.", input: Type.Object({ name: Type.Optional(Type.String()) }, { additionalProperties: false }), result: Type.Object({ greeting: Type.String() }) });
  const fail = defineOperation({ id: "acme.demo.fail", description: "Refuse the demo.", input: Type.Object({}), result: Type.Null() });
  const callback = defineOperation({ id: "acme.demo.callback", description: "Client callback.", input: Type.Object({}), result: Type.Null(), implementedBy: "client" });
  const large = defineOperation({ id: "acme.demo.large", description: "Read a large demo result.", input: Type.Object({}), result: Type.Object({ text: Type.String() }) });
  const methods = [
    ...coreMethods(coreSources({}, { plugins: host })),
    implement(demo, ({ name }) => ({ greeting: `Hello ${name ?? "demo"}` })),
    implement(fail, () => { throw new DomainError("demo-denied", "The demo refuses this call.", 403); }),
    implement(callback, () => null),
    implement(large, () => largeResult),
  ];
  host.methods.register("acme", methods);
  const server = await startRpcServer(t, { methods, routes: [{
    id: "acme.health",
    isApiPath: (pathname) => pathname === "/health",
    matches: (_request, url) => url.pathname === "/health",
    handle: ({ response }) => { response.writeHead(200); response.end("{}"); },
  }], accessFor: (request) => {
    requests.push(request.headers);
    return request.headers.authorization === "Bearer demo-token" ? unrestrictedAccess : createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights: [] } });
  } });
  const profile = path.join(directory, "ragents.config.demo.ts");
  await writeFile(profile, 'export const config = { host: { PORT: 4790 } };\n');
  const environment: NodeJS.ProcessEnv = { ...process.env, PORT: undefined, BIND_ADDRESS: undefined, DATA_DIR: directory, RAGENTS_URL: server.url, RAGENTS_TOKEN: "demo-token", RAGENTS_PROFILE: profile };
  const launch = (args: readonly string[], extra: NodeJS.ProcessEnv = {}, facade = true) => {
    const entry = facade ? [path.join(root, "scripts/package/ragents.mjs")] : ["--import", "tsx", path.join(root, "scripts/agent/agent-cli.ts")];
    const child = spawn(process.execPath, [...entry, "call", ...args], { cwd: path.join(root, "apps/server"), env: { ...environment, ...extra }, stdio: ["pipe", "pipe", "pipe"] });
    t.after(() => { child.kill(); });
    return child;
  };
  const invoke = (args: readonly string[], input = "", extra: NodeJS.ProcessEnv = {}, facade = true): Promise<{ code: number | null; stdout: string; stderr: string }> => new Promise((resolve, reject) => {
    const child = launch(args, extra, facade);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
    child.stdin.end(input);
  });
  return { directory, profile, server, requests, invoke, launch };
};

test("call parses method, stdin, raw, profile and list arguments", () => {
  assert.deepEqual(parseArguments(["call", "acme.demo.greet"]), { kind: "call", profile: process.env.RAGENTS_PROFILE ?? "developer", method: "acme.demo.greet", params: "{}", raw: false });
  assert.deepEqual(parseArguments(["call", "--profile", "demo", "acme.demo.greet", "-", "--raw"]), { kind: "call", profile: "demo", method: "acme.demo.greet", params: "-", raw: true });
  assert.deepEqual(parseArguments(["call", "--list", "--profile", "demo"]), { kind: "call-list", profile: "demo" });
  for (const args of [[], ["--raw"], ["--list", "acme.demo.greet"], ["--list", "--raw"], ["acme.demo.greet", "{}", "{}"], ["--profile"], ["acme.demo.greet", "--unknown"]]) {
    assert.throws(() => parseArguments(["call", ...args]));
  }
});

test("package and checkout call send one RPC request and print pretty or raw JSON", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const pretty = await f.invoke(["acme.demo.greet", '{"name":"Alice"}']);
  assert.equal(pretty.code, 0, pretty.stderr);
  assert.equal(pretty.stdout, '{\n  "greeting": "Hello Alice"\n}\n');
  assert.equal(pretty.stderr, "");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0]?.authorization, "Bearer demo-token");
  assert.equal(f.requests[0]?.origin, undefined);
  const raw = await f.invoke(["acme.demo.greet", "--raw"], "", {}, false);
  assert.equal(raw.code, 0, raw.stderr);
  assert.equal(raw.stdout, '{"greeting":"Hello demo"}\n');
  const stdin = await f.invoke(["acme.demo.greet", "-", "--raw"], '{"name":"stdin"}');
  assert.equal(stdin.code, 0, stdin.stderr);
  assert.equal(stdin.stdout, '{"greeting":"Hello stdin"}\n');
});

test("package and checkout call pipe complete JSON results larger than 1 MB", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  for (const facade of [true, false]) for (const raw of [false, true]) {
    const expected = Buffer.byteLength(`${JSON.stringify(largeResult, null, raw ? undefined : 2)}\n`);
    assert.ok(expected > 1024 * 1024);
    const child = f.launch(["acme.demo.large", "{}", ...(raw ? ["--raw"] : [])], {}, facade);
    const counter = spawn(process.execPath, ["-e", "let bytes = 0; process.stdin.on('data', (chunk) => { bytes += chunk.length; }); process.stdin.on('end', () => { console.log(bytes); });"], { stdio: ["pipe", "pipe", "pipe"] });
    t.after(() => { counter.kill(); });
    const completed = Promise.all([once(child, "close"), once(counter, "close")]);
    const counted: Buffer[] = [];
    const errors: Buffer[] = [];
    counter.stdout.on("data", (chunk: Buffer) => counted.push(chunk));
    for (const stderr of [child.stderr, counter.stderr]) stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.stdout.pipe(counter.stdin);
    child.stdin.end();
    const [[code], [counterCode]] = await completed;
    assert.equal(code, 0, Buffer.concat(errors).toString("utf8"));
    assert.equal(counterCode, 0, Buffer.concat(errors).toString("utf8"));
    assert.equal(Buffer.concat(errors).toString("utf8"), "");
    assert.equal(Number(Buffer.concat(counted).toString("utf8")), expected, `${facade ? "package" : "checkout"}, ${raw ? "raw" : "pretty"}`);
  }
});

test("call uses PORT, explicit profiles and the remembered host with the existing precedence", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const port = new URL(f.server.url).port;
  const fromPort = await f.invoke(["acme.demo.greet", "--profile", f.profile], "", { RAGENTS_URL: undefined, PORT: port });
  assert.equal(fromPort.code, 0, fromPort.stderr);
  writeHostRecord(f.directory, { profile: "demo", url: f.server.url, pid: process.pid, log: path.join(f.directory, "host.log"), startedAt: new Date().toISOString() });
  const fromRecord = await f.invoke(["acme.demo.greet"], "", { RAGENTS_URL: "http://127.0.0.1:1" });
  assert.equal(fromRecord.code, 0, fromRecord.stderr);
});

test("call --list uses core OpenRPC and shows one-line descriptions of server methods", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  const listed = await f.invoke(["--list"]);
  assert.equal(listed.code, 0, listed.stderr);
  assert.match(listed.stdout, /^ragents.api.openrpc  Read OpenRPC 1.3/m);
  assert.match(listed.stdout, /^acme.demo.greet  Greet the demo. Accept optional input.$/m);
  assert.doesNotMatch(listed.stdout, /acme.demo.callback/);
  assert.equal(f.requests.length, 1);
  const denied = await f.invoke(["--list"], "", { RAGENTS_TOKEN: undefined });
  assert.equal(denied.code, 1);
  assert.equal(denied.stdout, "");
  assert.match(denied.stderr, /runs.read/);
});

test("RPC errors, invalid params and unreachable hosts fail with stderr and no result", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  for (const [method, params, message] of [["acme.demo.missing", "{}", /Unknown method/], ["acme.demo.fail", "{}", /The demo refuses this call/], ["acme.demo.greet", '{"name":5}', /Invalid input/], ["acme.demo.greet", "invalid", /not JSON/], ["acme.demo.greet", "[]", /JSON object/], ["acme.demo.greet", "null", /JSON object/]] as const) {
    const result = await f.invoke([method, params]);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, message);
  }
  const empty = await f.invoke(["acme.demo.greet", "-"], "");
  assert.equal(empty.code, 1);
  assert.match(empty.stderr, /not JSON/);
  const unavailable = await f.invoke(["acme.demo.greet"], "", { RAGENTS_URL: "http://127.0.0.1:1" });
  assert.equal(unavailable.code, 1);
  assert.match(unavailable.stderr, /unreachable/);
});
