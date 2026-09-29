import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { readHomepageUiContracts } from "./homepage-ui-contracts.js";
import type { ChannelContract, OperationContract, RunFunction, PluginContext, ToolDescriptor } from "@ragents/engine";

export function showcasePluginIds(repoRoot: string): string[] {
  const source = ts.createSourceFile("showcase.ts", readFileSync(path.join(repoRoot, "ragents.config.showcase.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  const arrays: ts.ArrayLiteralExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "PLUGINS") {
      if (!ts.isArrayLiteralExpression(node.initializer)) throw new Error("showcase.PLUGINS must be a literal list.");
      arrays.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (arrays.length !== 1) throw new Error("Expected exactly one showcase.PLUGINS list.");
  const ids = arrays[0].elements.map((entry) => {
    if (!ts.isStringLiteral(entry) || !/^ragents\.[a-z][a-z0-9-]*$/.test(entry.text)) throw new Error("The public showcase profile contains a plugin reference that is not approved.");
    return entry.text;
  });
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error("Empty or duplicate showcase plugins.");
  return ids;
}

export function assertPublicOutput(text: string): void {
  if (/plugins\/(?!ragents\.)[a-z]|\/Users\/|\/private\/|\/tmp\/|PRIVATE_MODEL_API_KEY/i.test(text)) {
    throw new Error("The public reference contains a private name, local path, or configuration reference.");
  }
}

export function publicPackageFiles(directory: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (relative: string) => {
    for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) files[name] = readFileSync(path.join(directory, name), "utf8");
      else throw new Error(`Invalid file type in the public run script: ${name}`);
    }
  };
  visit("");
  return files;
}

async function collect(repoRoot: string) {
  globalThis.fetch = async () => { throw new Error("Reference generation must not make network calls."); };
  const { composeProfile } = await import("../../apps/server/src/profile/compose.js");
  const { agentTools, implement, implementChannel, modelToolDescriptors } = await import("@ragents/engine");
  const { coreContracts, runContracts } = await import("../../apps/server/src/api/contracts.js");
  const { methodReference, openRpcDocument } = await import("../../apps/server/src/api/reference.js");
  const { actorProgramAuthoringContracts } = await import("../../apps/server/src/plugin-support/actor-programs/authoring-contracts.js");
  const { serverApiDeclarations } = await import("../../apps/server/src/plugin-support/actor-programs/app-project.js");
  const { runModuleTemplates, templateFiles } = await import("../../plugins/ragents.actor-programs/server/templates.js");
  const { loadPlugins, resolvePluginEntries, staleBuiltInBundles } = await import("../../apps/server/src/profile/plugin-discovery.js");
  const { pluginFolder } = await import("../../apps/server/src/plugin-support/plugins-root.js");
  const ids = showcasePluginIds(repoRoot);
  // The reference shows what a user gets: the showcase profile from the built-in bundles.
  const stale = staleBuiltInBundles(resolvePluginEntries(ids));
  if (stale.length > 0) throw new Error(`Built-in bundles no longer match their sources under plugins/: ${stale.join(", ")}; run pnpm build:plugins first`);
  const loaded = await loadPlugins(ids);
  const workspace = process.env.DATA_DIR!;
  const host = composeProfile({ product: { id: "ragents", title: "RAgents" }, pluginIds: loaded.ids, modules: loaded.modules, web: loaded.web, executor: loaded.executor }, {
    ensureSession: () => { throw new Error("Reference generation must not create runs."); },
    runtime: () => { throw new Error("Reference generation must not start a runtime."); },
    ensureWorkspaceAccess: () => { throw new Error("Reference generation does not access any workspace."); },
    sessionWorkspaceFor: async () => ({ cwd: workspace, currentRoot: async () => workspace, runOperation: async <T>(operation: () => Promise<T>) => operation() }),
  });
  const context = {
    runId: "reference", actorId: "reference", turnId: null, workspace,
    actor: { id: "reference", kind: "agent", grants: [], lifecycle: { kind: "running" } },
    view: { id: "reference", ownerId: "reference", actors: [], pluginStates: [] },
  } as unknown as PluginContext;
  const entry = (tool: RunFunction, descriptor: ToolDescriptor, owner: string) => ({
    name: tool.name, label: tool.label, description: tool.description, owner,
    longDescription: tool.longDescription,
    scope: descriptor.scope,
    availability: descriptor.availability, availabilityDetail: descriptor.availabilityDetail,
    schema: tool.schema, resultSchema: tool.resultSchema, nativeTool: tool.nativeTool === true,
  });
  const tools = agentTools.map((tool) => {
    const descriptor = modelToolDescriptors.find((item) => item.name === tool.name);
    if (!descriptor) throw new Error(`Tool description missing: ${tool.name}`);
    return entry(tool, descriptor, "engine");
  });
  const unavailable = () => { throw new Error("Reference generation does not execute any methods."); };
  const contracts = (value: object): Array<OperationContract | ChannelContract> => Object.values(value)
    .flatMap((entry: object) => "kind" in entry ? [entry as OperationContract | ChannelContract] : contracts(entry));
  const declared = [coreContracts, runContracts].flatMap((group) => contracts(group));
  host.methods.register("host", declared.filter((contract) => contract.kind === "operation").map((contract) => implement(contract, unavailable)));
  host.channels.register("host", declared.filter((contract) => contract.kind === "channel").map((contract) => implementChannel(contract, unavailable)));
  const descriptors = host.tools.describe();
  const dynamic: string[] = [];
  for (const contributor of host.tools.entries()) {
    if (contributor.dynamic) { dynamic.push(contributor.name); continue; }
    const resolved = await contributor.tools(context);
    if (resolved.length !== contributor.descriptors.length) throw new Error(`Incomplete tool contribution: ${contributor.name}`);
    for (const tool of resolved) {
      const descriptor = descriptors.find((item) => item.source === contributor.name && item.name === tool.name);
      if (!descriptor || descriptor.description !== tool.description || !tool.schema || !tool.resultSchema) throw new Error(`Mismatched tool contract: ${tool.name}`);
      tools.push(entry(tool, descriptor, descriptor.owner));
    }
  }
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) throw new Error("Duplicate tool names.");
  return {
    plugins: host.publicManifests().map(({ id, requires }) => ({ id, requires })),
    tools: tools.sort((a, b) => a.name.localeCompare(b.name, "en")),
    operations: host.operations.describe(),
    starts: host.startEntries.describe(),
    scripts: host.startEntries.describe().filter((start) => start.action === "script").map((start) => {
      const script = host.startEntries.scriptPackage(start.id);
      if (!script) throw new Error(`Run script missing: ${start.id}`);
      const files = publicPackageFiles(path.join(pluginFolder(start.owner), "run-scripts", script.handle));
      if (!files["package.json"] || !files["RUN.md"] || !Object.keys(files).some((name) => /^tests\/.*\.test\.ts$/.test(name))) {
        throw new Error(`Incomplete package sources: ${start.id}`);
      }
      return { id: start.id, files };
    }),
    serverApiDeclarations: serverApiDeclarations(tools.filter((tool) => !["typescript_api", "typescript_eval"].includes(tool.name)).map((tool) => ({ ...tool, id: tool.name }))),
    actorProgramAuthoring: actorProgramAuthoringContracts(),
    clientUiFiles: readHomepageUiContracts(repoRoot).files,
    templates: runModuleTemplates.map((template) => ({ id: template.id, title: template.title, description: template.description, files: templateFiles(template, template.id) })),
    dynamic: dynamic.sort(),
    rpcReference: methodReference(host),
    openRpc: openRpcDocument(host),
  };
}

export type HomepageCatalog = Awaited<ReturnType<typeof collect>>;

if (process.argv.includes("--collect")) {
  const output = JSON.stringify(await collect(path.resolve(import.meta.dirname, "../..")));
  assertPublicOutput(output);
  process.stdout.write(output);
}
