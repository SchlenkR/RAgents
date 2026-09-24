import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { Type } from "typebox";
import { agentTools, Journal, Orchestration, type PluginContext, type PluginHost, type RunFunction } from "@ragents/engine";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import { nativeExecutorFixture } from "./native-executor-fixture.ts";
import { compositionEnvironment, showcaseFixture, type CompositionFixture } from "./fixtures/profile-composition/profiles.ts";

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "ragents-description-drift-"));
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

const composed = async (profile: CompositionFixture): Promise<PluginHost> => {
  const loaded = await loadPlugins(profile.plugins);
  const host = composeProfile(
    { product: profile.product, pluginIds: profile.plugins, modules: loaded.modules, web: loaded.web },
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

const proseExceptions: Readonly<Record<string, readonly string[]>> = {
  implementation_format: ["format"],
  implementation_preview_start: ["running"],
  implementation_report: ["active", "ready"],
  implementation_verify: ["format"],
};

const propertyNames = (schema: unknown, into: Set<string>, seen = new Set<object>()): void => {
  if (!schema || typeof schema !== "object" || seen.has(schema)) return;
  seen.add(schema);
  const record = schema as Record<string, unknown>;
  if (record.properties && typeof record.properties === "object") {
    for (const [name, child] of Object.entries(record.properties as Record<string, unknown>)) {
      into.add(name);
      propertyNames(child, into, seen);
    }
  }
  for (const key of ["items", "additionalProperties", "not"]) propertyNames(record[key], into, seen);
  for (const key of ["anyOf", "allOf", "oneOf", "prefixItems"]) for (const child of Array.isArray(record[key]) ? record[key] as unknown[] : []) propertyNames(child, into, seen);
  for (const child of record.$defs && typeof record.$defs === "object" ? Object.values(record.$defs as Record<string, unknown>) : []) propertyNames(child, into, seen);
};

const wordsOf = (text: string): readonly string[] => text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
const identifierLike = (word: string): boolean => /[A-Z0-9_]/.test(word.slice(1));
const germanProse = (text: string): boolean => (text.match(/\b(der|die|das|und|nicht|mit|für|ein|eine|des|dem|den|ist|sind|wird|werden|nur|kein|keine|oder|auch)\b/g) ?? []).length >= 2;

const allRunFunctions = async (): Promise<readonly RunFunction[]> => {
  const run = runtime.createRun({ commandId: "drift-run" }, { title: "Drift", ownerHandle: "user", ownerDisplayName: "User" });
  const view = runtime.view(run.id);
  const actor = view.actors.find((candidate) => candidate.id === run.ownerId)!;
  const context: PluginContext = { runId: run.id, actorId: actor.id, turnId: null, actor, view, workspace: workspaceDirectory };
  const byName = new Map<string, RunFunction>();
  for (const fn of agentTools) byName.set(fn.name, fn);
  const host = await composed(showcaseFixture);
  for (const contributor of host.tools.entries()) {
    for (const fn of await contributor.tools(context)) byName.set(fn.name, fn);
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
};

type Contract = Pick<RunFunction, "name" | "description" | "longDescription" | "schema" | "resultSchema">;

const driftsOf = (functions: readonly Contract[], exceptions: Readonly<Record<string, readonly string[]>>): readonly string[] => {
  const knownProperties = new Set<string>();
  for (const fn of functions) { propertyNames(fn.schema, knownProperties); propertyNames(fn.resultSchema, knownProperties); }
  const drifts: string[] = [];
  for (const fn of functions) {
    const own = new Set<string>();
    propertyNames(fn.schema, own);
    propertyNames(fn.resultSchema, own);
    const allowed = new Set(exceptions[fn.name] ?? []);
    const text = `${fn.description} ${fn.longDescription ?? ""}`;
    const german = germanProse(text);
    const foreign = [...new Set(wordsOf(text))]
      .filter((word) => knownProperties.has(word) && !own.has(word) && !allowed.has(word) && (german || identifierLike(word)));
    if (foreign.length > 0) drifts.push(`${fn.name}: ${foreign.join(", ")}`);
  }
  return drifts;
};

test("the drift check flags foreign field names in German prose and identifier-like names in English prose", () => {
  const status = { name: "status", description: "Liest den Stand; environment und audience stehen in der Auswahl.", schema: Type.Object({}), resultSchema: Type.Object({ phase: Type.String(), audienceRole: Type.String() }) };
  const select = { name: "select", description: "Selects an item with itemId; the phase and audienceRole come from status.", schema: Type.Object({ environment: Type.String(), audience: Type.String() }), resultSchema: Type.Object({ selection: Type.Object({ itemId: Type.Integer() }) }) };
  const plain = { name: "plain", description: "Returns the phase of the selected environment.", schema: Type.Object({}), resultSchema: Type.Object({}) };
  assert.deepEqual(driftsOf([status, select, plain], {}), ["status: environment, audience", "select: audienceRole"]);
  assert.deepEqual(driftsOf([status, select, plain], { status: ["environment", "audience"], select: ["audienceRole"] }), []);
});

test("run function descriptions name no field of another contract that their own schemas lack", async () => {
  const functions = await allRunFunctions();
  assert.ok(functions.length > 40, `Nur ${functions.length} Funktionen geladen`);
  const drifts = driftsOf(functions, proseExceptions);
  assert.deepEqual(drifts, [], `Funktionsbeschreibungen nennen Felder, die ihr eigener Vertrag nicht kennt:\n${drifts.join("\n")}`);
});
