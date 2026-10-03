import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, truncate, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createAccessContext, DomainError, HttpContributionRegistry, type AccessContext, type MethodContext, type ToolScope } from "@ragents/engine";
import { FILE_BYTES_LIMIT } from "@ragents/workspace-executor";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";
import { contentPathOf, documentsApiPrefix, grantedPathOf } from "../../../plugins/ragents.documents/contract.ts";
import { createContentRoute, createGrantMethod } from "../../../plugins/ragents.documents/server/files-route.ts";
import { DocumentGrants, GRANT_LIFETIME_MS } from "../../../plugins/ragents.documents/server/grants.ts";
import { createCopyTool } from "../../../plugins/ragents.workspace/server/copy-tool.ts";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

const access = (...rights: string[]) => createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights } });

/** A run on the server with its project folder, the document store under @documents and one skill under @skills; without its root the project folder is gone. */
const serverRun = async (t: TestContext, root: "present" | "gone" = "present") => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-document-content-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = path.join(directory, "project");
  const documents = path.join(directory, "documents");
  const skill = path.join(directory, "skills", "notes");
  const serverFolder = path.join(directory, "server");
  await Promise.all([path.join(project, "docs"), path.join(documents, "report"), skill, serverFolder].map((folder) => mkdir(folder, { recursive: true })));
  await writeFile(path.join(project, "docs", "guide.md"), "# Guide\n");
  await writeFile(path.join(documents, "report", "shot one.png"), png);
  await writeFile(path.join(skill, "SKILL.md"), "Skill\n");
  const missing = () => Promise.reject(new DomainError("workspace-path-missing", `The bound folder ${project} no longer exists on the server.`, 409));
  if (root === "gone") await rm(project, { recursive: true });
  const sandbox = new WorkspaceSandboxHost({
    contributorName: "test", contributions: [],
    workspaceFor: async () => ({ cwd: project, currentRoot: root === "gone" ? missing : async () => project, runOperation: (operation) => operation() }),
    identFor: async () => undefined, skillPaths: async () => [skill], homeFor: async () => ({ home: directory }),
    serverDirectoryFor: async () => serverFolder,
  });
  sandbox.registerWorkspaceRoot({ id: "ragents.documents", alias: "@documents", environmentVariable: "RAGENTS_DOCUMENTS_DIR", directoryFor: () => documents });
  t.after(() => sandbox.shutdownAll());
  return { directory, project, documents, sandbox };
};

const identities = { reader: access("runs.read"), inspector: access("runs.read", "runs.inspect"), anonymous: createAccessContext({ enabled: true, user: null }) };

type Identity = keyof typeof identities;

/** The content route behind the host's rights check, with the guards of run and workspace recorded per call; a grant in the address stands in for the sign-in as in the server. */
const contentServer = async (t: TestContext, run: Awaited<ReturnType<typeof serverRun>>, now: () => number = Date.now) => {
  const guards: string[] = [];
  const grants = new DocumentGrants(now);
  const contentAccess = {
    ensureSession: (runId: string) => { guards.push(`run:${runId}`); },
    ensureWorkspaceAccess: (_access: AccessContext, runId: string) => {
      guards.push(`workspace:${runId}`);
      if (runId === "owner-only") throw new DomainError("run-workspace-owner-only", "Only the owner reaches this workspace.", 403);
    },
  };
  const routes = new HttpContributionRegistry();
  routes.register("ragents.documents", [createContentRoute({ ...contentAccess, execute: run.sandbox.execute.bind(run.sandbox), grants })]);
  const grantMethod = createGrantMethod({ ...contentAccess, grants });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://localhost");
    try {
      const identity = routes.accessFromAddress(request, url) ?? identities[(request.headers["x-test-identity"] ?? "anonymous") as Identity];
      if (!await routes.dispatch(request, response, url, identity)) response.writeHead(404).end();
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      response.writeHead(error.status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error.message, code: error.code }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const get = (identity: Identity, runId: string, reference: string) =>
    fetch(`${origin}${contentPathOf(documentsApiPrefix, runId, reference)}`, { headers: { "x-test-identity": identity } });
  const grant = async (identity: Identity, runId: string, root: string) =>
    (await grantMethod.execute({ runId, root }, { access: identities[identity] } as MethodContext) as { grant: string }).grant;
  /** Exactly what an image of an HTML document in VS Code sends: no cookie, no token, only the grant in the path. */
  const granted = (runId: string, grantValue: string, reference: string) => fetch(`${origin}${grantedPathOf(documentsApiPrefix, runId, grantValue, reference)}`);
  const at = (address: string) => fetch(`${origin}${address}`, { headers: { "x-test-identity": "reader" } });
  return { guards, get, grant, granted, at };
};

const errorOf = async (response: Response) => ({ status: response.status, ...await response.json() as { error: string; code?: string } });

test("the content route serves a server root with runs.read and the run's root only to whoever may inspect its workspace", async (t) => {
  const run = await serverRun(t);
  const { guards, get } = await contentServer(t, run);

  const stored = await get("reader", "run-1", "@documents/report/shot one.png");
  assert.equal(stored.status, 200);
  assert.equal(stored.headers.get("content-type"), "image/png");
  assert.equal(stored.headers.get("cache-control"), "no-store");
  assert.equal(stored.headers.get("content-security-policy"), "sandbox");
  assert.deepEqual(Buffer.from(await stored.arrayBuffer()), png);
  assert.equal(await (await get("reader", "run-1", "@skills/notes/SKILL.md")).text(), "Skill\n");
  assert.deepEqual(guards, ["run:run-1", "run:run-1"]);

  assert.equal((await get("reader", "run-1", "docs/guide.md")).status, 403);
  const guide = await get("inspector", "run-1", "docs/guide.md");
  assert.equal(guide.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(await guide.text(), "# Guide\n");
  assert.equal(await (await get("inspector", "run-1", path.join(run.project, "docs", "guide.md"))).text(), "# Guide\n");
  assert.deepEqual(guards.slice(2), ["workspace:run-1", "workspace:run-1"]);
  assert.equal((await get("inspector", "owner-only", "docs/guide.md")).status, 403);
  assert.equal((await get("reader", "owner-only", "@documents/report/shot one.png")).status, 200, "the store is on the server, not in the owner's workspace");
});

test("the content route names missing files, folders, paths outside the roots and the size limit", async (t) => {
  const run = await serverRun(t);
  const { get } = await contentServer(t, run);
  const error = async (response: Response) => ({ status: response.status, error: (await response.json() as { error: string }).error });

  assert.deepEqual(await error(await get("reader", "run-1", "@documents/report/missing.png")), { status: 404, error: "Not found: @documents/report/missing.png" });
  assert.deepEqual(await error(await get("reader", "run-1", "@documents/report")), { status: 400, error: "@documents/report is a folder, not a file" });
  assert.equal((await error(await get("reader", "run-1", "@apps/list.ts"))).status, 400);
  await writeFile(path.join(run.directory, "secret.md"), "Secret\n");
  assert.deepEqual(await error(await get("inspector", "run-1", path.join(run.directory, "secret.md"))), {
    status: 400, error: `Path outside the working directory: ${path.join(run.directory, "secret.md")}`,
  });
  await writeFile(path.join(run.documents, "large.bin"), "");
  await truncate(path.join(run.documents, "large.bin"), FILE_BYTES_LIMIT + 1);
  const large = await error(await get("reader", "run-1", "@documents/large.bin"));
  assert.equal(large.status, 413);
  assert.match(large.error, /larger than 16 MiB/);
});

test("copy carries files and folders between the run's root and @documents unchanged, never into a read-only root", async (t) => {
  const run = await serverRun(t);
  const copy = createCopyTool(run.sandbox);
  const scope = { caller: { runId: "run-1", actorId: "actor-1", turnId: "turn-1" }, signal: undefined } as unknown as ToolScope;
  const call = (input: unknown) => copy.run(scope, "copy-1", input as never);

  assert.equal(await call({ source: "@documents/report/shot one.png", destination: "docs/shot.png" }), "Copied 1 file.");
  assert.deepEqual(await readFile(path.join(run.project, "docs", "shot.png")), png);
  assert.equal(await call({ source: "docs", destination: "@documents/project-docs" }), "Copied 2 files.");
  assert.equal(await readFile(path.join(run.documents, "project-docs", "guide.md"), "utf8"), "# Guide\n");
  assert.deepEqual(await readFile(path.join(run.documents, "project-docs", "shot.png")), png);
  await writeFile(path.join(run.project, "docs", "guide.md"), "# Guide, changed\n");
  assert.equal(await call({ source: "docs/guide.md", destination: "@documents/project-docs/guide.md" }), "Copied 1 file.");
  assert.equal(await readFile(path.join(run.documents, "project-docs", "guide.md"), "utf8"), "# Guide, changed\n");
  await assert.rejects(call({ source: "docs/guide.md", destination: "@skills/notes/guide.md" }), /outside the working directory: @skills\/notes\/guide\.md/);
  await assert.rejects(call({ source: "missing.md", destination: "@documents/missing.md" }), /Not found: missing\.md/);
  assert.equal(copy.executionMode, "sequential");
  assert.deepEqual(Object.keys((copy.schema as { properties: object }).properties), ["source", "destination"]);
});

test("a grant serves the files of one root of its run without a sign-in, to whoever may read them, and only for a while", async (t) => {
  const run = await serverRun(t);
  let clock = Date.now();
  const { guards, grant, granted } = await contentServer(t, run, () => clock);

  const store = await grant("reader", "run-1", "@documents");
  assert.match(store, /^[A-Za-z0-9_-]{43}$/);
  const shot = await granted("run-1", store, "@documents/report/shot one.png");
  assert.equal(shot.status, 200);
  assert.equal(shot.headers.get("content-security-policy"), "sandbox");
  assert.deepEqual(Buffer.from(await shot.arrayBuffer()), png);
  assert.deepEqual(guards, ["run:run-1", "run:run-1"], "issuing and every use run the run check");

  assert.deepEqual(await errorOf(await granted("run-1", store, "docs/guide.md")), {
    status: 403, code: "document-grant-outside", error: "The grant in this address covers @documents, not docs/guide.md.",
  });
  assert.equal((await errorOf(await granted("run-1", store, "@skills/notes/SKILL.md"))).code, "document-grant-outside");
  assert.equal((await errorOf(await granted("run-2", store, "@documents/report/shot one.png"))).code, "document-grant-invalid", "bound to its run");
  assert.equal((await errorOf(await granted("run-1", "x".repeat(43), "@documents/report/shot one.png"))).code, "document-grant-invalid");

  await assert.rejects(grant("reader", "run-1", ""), (error: unknown) => error instanceof DomainError && error.code === "access-denied" && /runs\.inspect/.test(error.message));
  await assert.rejects(grant("inspector", "owner-only", ""), /Only the owner reaches this workspace/);
  const project = await grant("inspector", "run-1", "");
  assert.equal(await (await granted("run-1", project, "docs/guide.md")).text(), "# Guide\n");
  assert.equal((await errorOf(await granted("run-1", project, "@documents/report/shot one.png"))).code, "document-grant-outside");

  clock += GRANT_LIFETIME_MS;
  assert.deepEqual(await errorOf(await granted("run-1", store, "@documents/report/shot one.png")), {
    status: 403, code: "document-grant-invalid", error: "The grant in this address is unknown or expired; open the document again.",
  });
});

test("an address whose segments hide a separator or climb with .. names no file, so an alias never leads into the run's root", async (t) => {
  const run = await serverRun(t);
  const { at, grant } = await contentServer(t, run);
  const raw = `${documentsApiPrefix}/runs/run-1/raw`;
  for (const crafted of ["@documents%2F..%2Fproject%2Fdocs%2Fguide.md", "@documents/..%2Fproject%2Fdocs%2Fguide.md", "@documents/..%5Cproject%5Cdocs%5Cguide.md"]) {
    assert.equal((await at(`${raw}/${crafted}`)).status, 403, `${crafted}: without runs.inspect it counts as the run's root`);
  }
  const store = await grant("reader", "run-1", "@documents");
  const response = await at(`${documentsApiPrefix}/runs/run-1/grant/${store}/@documents%2F..%2Fproject%2Fdocs%2Fguide.md`);
  assert.equal((await errorOf(response)).code, "access-denied", "with a grant of the store it counts as the run's root as well");
});

test("the store stays readable when the run's own root is gone, the run's root names why it is missing", async (t) => {
  const run = await serverRun(t, "gone");
  const { get } = await contentServer(t, run);
  const stored = await get("reader", "run-1", "@documents/report/shot one.png");
  assert.equal(stored.status, 200);
  assert.deepEqual(Buffer.from(await stored.arrayBuffer()), png);
  assert.equal(await (await get("reader", "run-1", "@skills/notes/SKILL.md")).text(), "Skill\n");
  assert.deepEqual(await errorOf(await get("inspector", "run-1", "docs/guide.md")), {
    status: 409, error: `The bound folder ${run.project} no longer exists on the server.`,
  });
  assert.equal((await get("reader", "run-1", "@documents/../project/docs/guide.md")).status, 403, "the URL leaves the alias before it reaches the route");
});
