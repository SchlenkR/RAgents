import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, truncate, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createAccessContext, DomainError, HttpContributionRegistry, type ToolScope } from "@ragents/engine";
import { FILE_BYTES_LIMIT } from "@ragents/workspace-executor";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";
import { contentPathOf, documentsApiPrefix } from "../../../plugins/ragents.documents/contract.ts";
import { createContentRoute } from "../../../plugins/ragents.documents/server/files-route.ts";
import { createCopyTool } from "../../../plugins/ragents.workspace/server/copy-tool.ts";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

const access = (...rights: string[]) => createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights } });

/** A run on the server with its project folder, the document store under @documents and one skill under @skills. */
const serverRun = async (t: TestContext) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-document-content-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = path.join(directory, "project");
  const documents = path.join(directory, "documents");
  const skill = path.join(directory, "skills", "notes");
  await Promise.all([path.join(project, "docs"), path.join(documents, "report"), skill].map((folder) => mkdir(folder, { recursive: true })));
  await writeFile(path.join(project, "docs", "guide.md"), "# Guide\n");
  await writeFile(path.join(documents, "report", "shot one.png"), png);
  await writeFile(path.join(skill, "SKILL.md"), "Skill\n");
  const sandbox = new WorkspaceSandboxHost({
    contributorName: "test", contributions: [],
    workspaceFor: async () => ({ cwd: project, currentRoot: async () => project, runOperation: (operation) => operation() }),
    identFor: async () => undefined, skillPaths: async () => [skill], homeFor: async () => ({ home: directory }),
  });
  sandbox.registerWorkspaceRoot({ id: "ragents.documents", alias: "@documents", environmentVariable: "RAGENTS_DOCUMENTS_DIR", directoryFor: () => documents });
  t.after(() => sandbox.shutdownAll());
  return { directory, project, documents, sandbox };
};

/** The content route behind the host's rights check, with the guards of run and workspace recorded per call. */
const contentServer = async (t: TestContext, run: Awaited<ReturnType<typeof serverRun>>) => {
  const guards: string[] = [];
  const routes = new HttpContributionRegistry();
  routes.register("ragents.documents", [createContentRoute({
    ensureSession: (runId) => { guards.push(`run:${runId}`); },
    ensureWorkspaceAccess: (_access, runId) => {
      guards.push(`workspace:${runId}`);
      if (runId === "owner-only") throw new DomainError("run-workspace-owner-only", "Only the owner reaches this workspace.", 403);
    },
    execute: run.sandbox.execute.bind(run.sandbox),
  })]);
  const identities = { reader: access("runs.read"), inspector: access("runs.read", "runs.inspect") };
  const server = createServer(async (request, response) => {
    const identity = identities[request.headers["x-test-identity"] as keyof typeof identities];
    if (!await routes.dispatch(request, response, new URL(request.url!, "http://localhost"), identity)) response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const get = (identity: keyof typeof identities, runId: string, reference: string) =>
    fetch(`http://127.0.0.1:${address.port}${contentPathOf(documentsApiPrefix, runId, reference)}`, { headers: { "x-test-identity": identity } });
  return { guards, get };
};

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
