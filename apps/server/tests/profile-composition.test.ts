import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import { createAccessContext, DomainError, Journal, Orchestration, RpcPeer, type PluginContext, type PluginHost, type PluginState } from "@ragents/engine";
import { RpcConnection, RpcDispatcher } from "../src/rpc/dispatcher.ts";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import { nativeExecutorFixture } from "./native-executor-fixture.ts";

import { compositionEnvironment, showcaseFixture, minimalFixture, type CompositionFixture } from "./fixtures/profile-composition/profiles.ts";

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "ragents-composition-"));
const workspaceDirectory = path.join(temporaryDirectory, "workspace");
mkdirSync(workspaceDirectory);
const environment = { ...compositionEnvironment, DATA_DIR: path.join(temporaryDirectory, "data") };
const previousEnvironment = new Map(Object.keys(environment).map((key) => [key, process.env[key]]));
for (const [key, value] of Object.entries(environment)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
const hosts: PluginHost[] = [];
const native = nativeExecutorFixture();
const services = { ...testServices(), nativeTypeScriptExecutor: native.executor };
const journal = new Journal(":memory:", services);
const runtime = new Orchestration(journal, services);
after(async () => {
  try { await Promise.all(hosts.map((host) => host.lifecycle.shutdown())); }
  finally {
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    journal.close();
    await native.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

const { loadPlugins } = await import("../src/profile/plugin-discovery.ts");
const { composeProfile } = await import("../src/profile/compose.ts");
const { documentStoreToken } = await import("../src/ragents/document-store.ts");
const { productRuntimeToken } = await import("../src/ragents/product-runtime.ts");
const { workspaceRuntimeToken } = await import("../src/ragents/workspace-runtime.ts");
const { browserRuntimeToken } = await import("../../../plugins/ragents.browser/server/contract.ts");

const composed = async (profile: CompositionFixture, defaultStartEntry?: string): Promise<PluginHost> => {
  const loaded = await loadPlugins(profile.plugins);
  const host = composeProfile(
    { product: profile.product, pluginIds: profile.plugins, modules: loaded.modules, web: loaded.web, executor: loaded.executor, ...(defaultStartEntry === undefined ? {} : { defaultStartEntry }) },
    {
      ensureSession: () => {},
      ensureWorkspaceAccess: () => {},
      runtime: () => runtime,
      sessionWorkspaceFor: () => Promise.resolve({
        cwd: workspaceDirectory,
        currentRoot: () => Promise.resolve(workspaceDirectory),
        runOperation: <T>(operation: () => Promise<T>) => operation(),
      }),
    },
  );
  hosts.push(host);
  return host;
};

const names = (values: readonly { id: string }[]): readonly string[] => values.map((entry) => entry.id).sort();

const restricted = { can: (right: string) => right === "runs.read" };
const programState: PluginState = {
  pluginId: "ragents.actor-programs", scope: { kind: "actor", actorId: "board" }, updatedAt: "2026-09-29T10:00:00.000Z",
  state: { version: 1, program: { name: "board", directory: "/private/programs/board" } },
};

test("actor-program prompt composition keeps the full guide exclusively in the reference query", async () => {
  const host = await composed(showcaseFixture);
  const snapshot = await host.prompts.snapshot({});
  const prompts = snapshot.contributions.filter((entry) => entry.id.startsWith("ragents.actor-programs."));
  const summary = prompts.find((entry) => entry.id === "ragents.actor-programs.summary");
  assert.ok(summary);
  assert.deepEqual(prompts.map((entry) => entry.id), ["ragents.actor-programs.summary"]);
  const functions = host.tools.describe();
  assert.ok(summary.requiresTools.some((tool) => functions.some((entry) => entry.name === tool)));
  assert.match(summary.content, /topic.*guide/);
  assert.ok(summary.content.length < 1500);
  assert.doesNotMatch(summary.content, /stateSchema|mockCapabilities|additionalProperties/);
  assert.ok(summary.requiresTools.includes("actor_program_create"));
  const minimal = await composed(minimalFixture);
  assert.equal((await minimal.prompts.snapshot({})).contributions.some((entry) => entry.id.startsWith("ragents.actor-programs.")), false);
});

test("the workspace rules hang on its tools and stay in the system prompt", async () => {
  const host = await composed(minimalFixture);
  const rules = (await host.prompts.snapshot({})).contributions.find((entry) => entry.id === "ragents.workspace.prompt");
  assert.ok(rules);
  assert.equal(rules.delivery, "initial");
  assert.deepEqual([...rules.requiresTools].sort(), ["bash", "edit", "read", "write"]);
  const native = host.tools.describe().filter((entry) => entry.nativeTool).map((entry) => entry.name);
  assert.ok(rules.requiresTools.every((tool) => native.includes(tool)));
  const chapters = await host.prompts.describe({}, { delivery: "on-demand", toolNames: rules.requiresTools });
  assert.equal(chapters.some((entry) => entry.id === rules.id), false);
});

test("the neutral showcase fixture composes real plugins and folder contributions completely", async () => {
  const host = await composed(showcaseFixture);
  const profile = host.publicProfile();

  assert.deepEqual(profile.product, showcaseFixture.product);
  assert.deepEqual(profile.plugins.map((entry) => entry.id), [...showcaseFixture.plugins]);
  assert.ok(host.optionalService(productRuntimeToken), "ProductRuntime is missing");
  assert.ok(host.optionalService(workspaceRuntimeToken), "WorkspaceRuntime is missing");
  assert.ok(host.optionalService(browserRuntimeToken), "browser service is missing");
  assert.deepEqual(names(host.operations.describe()), ["actor_input"]);
  assert.deepEqual(host.tools.describe().map((tool) => tool.name).sort(), [
    "ask_user", "bash", "document_write", "edit",
    "fsharp_close", "fsharp_diagnostics", "fsharp_open",
    "actor_program_activate", "actor_program_controls", "actor_program_create", "actor_program_diagnostics", "actor_program_ensure", "actor_program_list", "actor_program_remove", "actor_view_set_visibility", "actor_view_snapshot",
    "browser_open", "browser_snapshot", "browser_click", "browser_fill", "browser_select", "browser_press", "browser_check", "browser_viewport", "browser_screenshot", "browser_view_screenshot", "browser_close",
    "read", "roslyn_close", "roslyn_diagnostics", "roslyn_open", "roslyn_solutions", "run_script_list", "run_script_start", "run_stop",
    "show_document", "todo_replace",
    "typescript_api", "typescript_close", "typescript_eval", "typescript_diagnostics", "typescript_open", "watch_create", "watch_list", "watch_remove", "write",
  ].sort());

  assert.ok(profile.startEntries.every((entry) => entry.owner === "ragents.reference"));
  const { folderSkills, pluginFolder } = await import("../src/plugin-support/plugin-folder.ts");
  assert.equal(profile.startEntries.filter((entry) => entry.action === "skill").length,
    folderSkills(pluginFolder("ragents.reference"), "ragents.reference").startEntries.length);
  const globalSkills = (await host.skills.global()).map((skill) => path.basename(skill));
  assert.deepEqual(profile.startEntries.filter((entry) => entry.action === "skill").map((entry) => entry.skill).filter((skill) => !globalSkills.includes(skill)), [], "every skill template needs its registered skill");
  assert.deepEqual(
    profile.startEntries.filter((entry) => entry.action === "script").map((entry) => entry.id),
    ["ragents.reference.shared-actor-list", "ragents.reference.conversation-circle", "ragents.reference.moderated-round", "ragents.reference.balcony-wizard", "ragents.reference.learning-afternoon", "ragents.reference.word-game", "ragents.reference.run-roster", "ragents.reference.quick-note"],
  );
  assert.ok(profile.startEntries.every((entry) => !("files" in entry) && !("programs" in entry)), "a run script does not reveal its source");
  assert.deepEqual(host.startOptions.describe(), [{ id: "ragents.workspace.binding", owner: "ragents.workspace" }, { id: "ragents.model", owner: "ragents.product" }]);
  assert.equal(JSON.stringify(host.accessProjections.state(programState, restricted)), JSON.stringify({ ...programState, state: { version: 1, program: { name: "board", views: [] } } }), "actor programs bring their projection");
  assert.equal(host.service(workspaceRuntimeToken).describe().mode, "per-run");
  assert.ok(host.optionalService(documentStoreToken), "document store is missing");
});

test("a reduced fixture removes optional actor program and reference contributions", async () => {
  const host = await composed(minimalFixture);
  const profile = host.publicProfile();
  assert.deepEqual(profile.product, minimalFixture.product);
  assert.deepEqual(profile.plugins.map((entry) => entry.id), [...minimalFixture.plugins]);
  assert.ok(host.optionalService(productRuntimeToken), "ProductRuntime is missing");
  assert.ok(host.optionalService(workspaceRuntimeToken), "WorkspaceRuntime is missing");
  assert.deepEqual(names(host.operations.describe()), ["actor_input"]);
  assert.equal(host.tools.describe().some((tool) => tool.name.startsWith("actor_program_") || tool.name.startsWith("actor_view_")), false);
  assert.deepEqual(host.tools.describe().filter((entry) => entry.nativeTool).map((entry) => entry.name).sort(), ["ask_user", "bash", "document_write", "edit", "read", "show_document", "typescript_api", "typescript_eval", "write"]);
  assert.deepEqual(await host.skills.global(), []);
  assert.equal(profile.startEntries.some((entry) => entry.owner === "ragents.reference"), false);
  assert.equal(host.accessProjections.state(programState, restricted), programState, "without the plugin the host knows no projection");
});

test("the default template of the profile file must be a registered template and then appears in the bootstrap", async () => {
  const host = await composed(showcaseFixture, "ragents.reference.word-game");
  assert.equal(host.publicProfile().defaultStartEntry, "ragents.reference.word-game");
  assert.equal("defaultStartEntry" in (await composed(showcaseFixture)).publicProfile(), false);
  await assert.rejects(composed(minimalFixture, "ragents.reference.word-game"), /defaultStartEntry ragents\.reference\.word-game is not a registered template/);
});

test("every plugin carries its requires from the module contract into the manifest", async () => {
  const host = await composed(showcaseFixture);
  const manifests = new Map(host.publicManifests().map((manifest) => [manifest.id, manifest.requires]));

  assert.deepEqual(manifests.get("ragents.orchestration"), []);
  assert.deepEqual(manifests.get("ragents.actor-programs"), ["ragents.orchestration", "ragents.ask"]);
  assert.deepEqual(manifests.get("ragents.browser"), ["ragents.documents"]);
  assert.deepEqual(manifests.get("ragents.product"), ["ragents.orchestration", "ragents.workspace"]);
  assert.deepEqual(manifests.get("ragents.reference"), ["ragents.orchestration", "ragents.actor-programs"]);
});

test("a plugin without its required plugin aborts the start", async () => {
  await assert.rejects(
    () => loadPlugins(["ragents.orchestration", "ragents.browser"]),
    /ragents\.browser needs the missing plugin ragents\.documents/,
  );
});

test("technical plugin methods require runs.inspect in the contract, the dispatcher checks it before every file access", async () => {
  const access = createAccessContext({ enabled: false, user: { id: "operator", label: "Operator", rights: ["runs.read", "runs.write"] } });
  const host = await composed(showcaseFixture);
  const dispatcher = new RpcDispatcher({ methods: host.methods, channels: host.channels });
  const connection = new RpcConnection({ id: "test", access, local: true, peer: new RpcPeer({ send: () => undefined }), streamless: true }, dispatcher);
  const context = { id: 1, signal: new AbortController().signal, progress: () => undefined };
  for (const [method, params] of [
    ["ragents.workspace.browse.list", { runId: "example", root: "workspace", path: "" }],
    ["ragents.actor-programs.source", { runId: "example", viewId: "board", revision: "r1" }],
  ] as const) {
    assert.ok(host.methods.find(method)?.contribution.contract.rights.includes("runs.inspect"), method);
    await assert.rejects(dispatcher.dispatch(connection, method, params, context), (error: unknown) =>
      error instanceof DomainError && error.code === "access-denied" && /runs\.inspect/.test(error.message), method);
  }
});

const toolResolutionContext = {
  runId: "run-1",
  actorId: "actor-1",
  turnId: null,
  actor: { id: "actor-1", kind: "agent", grants: [], lifecycle: { kind: "running" } },
  view: { id: "run-1", ownerId: "actor-0", actors: [], pluginStates: [] },
  workspace: workspaceDirectory,
} as unknown as PluginContext;

test("no prompt contribution and no tool description names the variable of a server root, only its alias", async () => {
  const host = await composed(showcaseFixture);
  const toolNames = host.tools.describe().map((tool) => tool.name);
  const prompts = [
    ...(await host.prompts.snapshot({})).contributions,
    ...await host.prompts.describe({}, { delivery: "on-demand", toolNames }),
  ].map((entry) => [entry.id, entry.content] as const);
  const functions = (await Promise.all(host.tools.entries().map((contributor) => contributor.tools(toolResolutionContext)))).flat()
    .map((fn) => [fn.name, [fn.description, fn.longDescription ?? "", JSON.stringify(fn.schema)].join("\n")] as const);
  const { actorProgramGuide } = await import("../../../plugins/ragents.actor-programs/server/prompts.ts");
  for (const [id, text] of [...prompts, ...functions, ["actor_program_controls guide", await actorProgramGuide.render({})] as const]) {
    assert.doesNotMatch(text, /RAGENTS_[A-Z_]+_DIR/, id);
  }
  assert.match(prompts.find(([id]) => id === "ragents.actor-programs.summary")?.[1] ?? "", /cwd: "@actors\/<name>"/);
});

test("function catalogs keep compact descriptions while runtime functions retain detailed instructions", async () => {
  const { createReadToolDefinition, createEditToolDefinition, createWriteToolDefinition, createBashToolDefinition } = await import("@ragents/agent");
  const originals = [createReadToolDefinition("."), createEditToolDefinition("."), createWriteToolDefinition("."), createBashToolDefinition(".")];
  const host = await composed(showcaseFixture);
  const descriptors = host.tools.describe();
  const functions = (await Promise.all(host.tools.entries().map((contributor) => contributor.tools(toolResolutionContext)))).flat();

  for (const original of originals) {
    const fn = functions.find((entry) => entry.name === original.name);
    assert.ok(fn, original.name);
    assert.equal(fn.longDescription, original.description, original.name);
    assert.ok(fn.description.length < original.description.length, original.name);
    assert.equal(descriptors.find((entry) => entry.name === original.name)?.description, fn.description);
  }

  for (const name of ["actor_program_controls", "actor_program_activate", "ask_user", "show_document", "todo_replace"]) {
    const fn = functions.find((entry) => entry.name === name);
    assert.ok(fn?.longDescription, name);
    assert.ok(fn.description.length < 180, name);
    assert.equal(descriptors.find((entry) => entry.name === name)?.description, fn.description);
    assert.equal("longDescription" in descriptors.find((entry) => entry.name === name)!, false);
  }
  assert.match(functions.find((entry) => entry.name === "actor_program_controls")!.longDescription!, /@ragents\/client\/ui/);
});

test("no tool offers the model a union at the root of its input schema", async () => {
  const { agentTools } = await import("@ragents/engine");
  const roots = new Map<string, { type?: unknown; anyOf?: unknown; oneOf?: unknown }>();

  for (const tool of agentTools) roots.set(tool.name, tool.schema);

  for (const fixture of [showcaseFixture, minimalFixture]) {
    const host = await composed(fixture);
    for (const contributor of host.tools.entries()) {
      for (const tool of await contributor.tools(toolResolutionContext)) roots.set(tool.name, tool.schema);
    }
  }

  assert.ok(roots.has("actor_program_activate") && roots.has("show_document"), "tool resolution stayed empty");
  const unions = [...roots]
    .filter(([, schema]) => schema.type !== "object" || schema.anyOf !== undefined || schema.oneOf !== undefined)
    .map(([name]) => name);

  assert.deepEqual(unions, []);
});
