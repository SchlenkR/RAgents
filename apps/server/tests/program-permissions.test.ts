import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createAccessContext } from "@ragents/engine";
import { allGrants, setupRun } from "../../../packages/ragents/tests/support.ts";
import { grantedPermissions, permittedFile, watchedFolderOf, watchedFolders } from "../../../plugins/ragents.actor-programs/server/permissions.ts";
import { count, programFiles, triggerFixture } from "./program-triggers-fixture.ts";

const helpers = ["program_file_read", "program_file_write", "program_http_request"];

test("file permissions and watches compare symlinked grants and folders by their real paths", async (t) => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-permission-paths-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const target = path.join(base, "permitted folder");
  const alias = path.join(base, "folder-link");
  await mkdir(target);
  await symlink(target, alias, "junction");
  await writeFile(path.join(target, "input.txt"), "permitted input");
  const actor = { ...setupRun().agent, grants: [{ capability: "workspace.use" as const, scope: { kind: "workspace" as const, path: alias }, usable: true, delegable: true }] };
  const grantor = { actor, access: createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights: ["runs.read", "runs.write"] } }), roots: async () => ({ read: [alias], write: [alias] }) };
  const permissions = await grantedPermissions({ files: { read: [alias, target], write: [alias] } }, grantor);
  assert.deepEqual(permissions, { files: { read: [target], write: [target] } });
  assert.deepEqual(await watchedFolders([alias], permissions), [target]);
  assert.equal(await watchedFolderOf(permissions, path.join(alias, "input.txt")), target);
  assert.equal(await permittedFile(permissions, path.join(alias, "new", "output.txt"), "write"), path.join(target, "new", "output.txt"));
  await assert.rejects(permittedFile(permissions, path.join(base, "outside.txt"), "read"), /outside the working directory/);
  await assert.rejects(grantedPermissions({ files: { read: [alias] } }, { ...grantor, actor: { ...actor, grants: actor.grants.map((grant) => ({ ...grant, delegable: false })) } }), /cannot delegate access/);
});

test("file and HTTP permissions enforce declared folders, symlinks, hosts and redirects outside the program code", { timeout: 90000 }, async (t) => {
  const f = await triggerFixture(t);
  const allowed = await realpath(await mkdir(path.join(f.directory, "allowed"), { recursive: true }).then(() => path.join(f.directory, "allowed")));
  const outside = path.join(f.directory, "outside");
  await mkdir(outside);
  await writeFile(path.join(allowed, "input.txt"), "allowed input");
  await writeFile(path.join(outside, "private.txt"), "outside input");
  await symlink(path.join(outside, "private.txt"), path.join(allowed, "link.txt"));
  const server = createServer((request, response) => {
    if (request.url === "/redirect") { response.writeHead(302, { location: "/ok" }); response.end(); }
    else response.end("HTTP result");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const host = `127.0.0.1:${address.port}`;
  const manifest = { permissions: { files: { read: [allowed], write: [allowed] }, http: [host] } };
  await f.activate("check", programFiles(`
    const text = await context.functions.program_file_read({ path: ${JSON.stringify(path.join(allowed, "input.txt"))} });
    await context.functions.program_file_write({ path: ${JSON.stringify(path.join(allowed, "output.txt"))}, content: text });
    const response = await context.functions.program_http_request({ url: "http://${host}/ok" });
    context.log(response.body);`, manifest, helpers));
  f.scheduler.start();
  await f.trigger("check");
  await f.settled("check");
  assert.equal(await readFile(path.join(allowed, "output.txt"), "utf8"), "allowed input");
  assert.equal((await f.status("check")).log.at(-1)?.text, "HTTP result");
  assert.deepEqual((await f.status("check")).permissions, manifest.permissions);
  for (const body of [
    `await context.functions.program_file_read({ path: ${JSON.stringify(path.join(outside, "private.txt"))} });`,
    `await context.functions.program_file_read({ path: ${JSON.stringify(path.join(allowed, "link.txt"))} });`,
    `await context.functions.program_http_request({ url: "http://localhost:${address.port}/ok" });`,
    `await context.functions.program_http_request({ url: "http://${host}/redirect" });`,
    `await context.functions.program_http_request({ url: "http://${host}/ok", headers: { Host: "another.example" } });`,
  ]) {
    await f.activate("check", programFiles(body, manifest, helpers));
    await f.trigger("check");
    await f.settled("check", "failed");
    assert.match(f.progress("check").lastResult!.summary, /outside|not permitted|redirect|override/);
  }
});

test("activation grants only what the activating actor and the run owner can give", { timeout: 90000 }, async (t) => {
  const f = await triggerFixture(t, { grants: [
    ...allGrants().filter((grant) => grant.capability !== "workspace.use"),
    { capability: "workspace.use", scope: { kind: "workspace", path: "/home/user/allowed" }, usable: true, delegable: true },
  ] });
  const folder = await realpath(await mkdir(path.join(f.directory, "data"), { recursive: true }).then(() => path.join(f.directory, "data")));
  const check = (name: string, ragents: Record<string, unknown>, capabilities: readonly string[] = []) => f.write(name, programFiles(count, ragents, capabilities))
    .then(() => f.programs.check(f.runId, name, f.setup.agent.id));
  await assert.rejects(check("folder", { permissions: { files: { read: [folder] } } }), /cannot delegate access/);
  await assert.rejects(check("missing", { permissions: { files: { read: [path.join(folder, "missing")] } } }), /need existing folders/);
  await assert.rejects(check("relative", { permissions: { files: { write: ["data"] } } }), /absolute server folders/);
  await assert.rejects(check("host", { permissions: { http: ["Example.com/path"] } }), /exact lowercase hosts/);
  await assert.rejects(check("helper", {}, ["program_http_request"]), /program_http_request needs permissions\.http/);
  const owner = await f.programs.check(f.runId, "folder", f.setup.view.ownerId);
  assert.deepEqual(owner.definition.permissions, { files: { read: [folder] } });
  f.setOwnerAccess(createAccessContext({ enabled: false, user: { id: "reader", label: "Reader", rights: ["runs.read"] } }));
  await f.write("writer", programFiles(count, { permissions: { files: { write: [folder] } } }));
  await assert.rejects(f.programs.check(f.runId, "writer", f.setup.view.ownerId), /Missing permission runs\.write/);
  f.setOwnerAccess(createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights: ["runs.read", "runs.write"] } }));
  await assert.rejects(f.programs.check(f.runId, "writer", f.setup.view.ownerId), /outside the working directory/, "without full rights a folder must lie within the run's workspace");
});

test("a helper call fails once the run owner loses the right it needs", { timeout: 60000 }, async (t) => {
  const f = await triggerFixture(t);
  const folder = await realpath(await mkdir(path.join(f.directory, "notes"), { recursive: true }).then(() => path.join(f.directory, "notes")));
  await f.activate("check", programFiles(`await context.functions.program_file_write({ path: ${JSON.stringify(path.join(folder, "note.txt"))}, content: "note" }); ${count}`, { permissions: { files: { write: [folder] } } }, ["program_file_write"]));
  f.scheduler.start();
  f.setOwnerAccess(createAccessContext({ enabled: false, user: { id: "reader", label: "Reader", rights: ["runs.read"] } }));
  await f.trigger("check");
  await f.settled("check", "failed");
  assert.match(f.progress("check").lastResult!.summary, /lacks runs\.write/);
  assert.deepEqual(f.state("check"), {});
});
