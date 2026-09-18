import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { readHomepageUiContracts } from "./homepage-ui-contracts.js";
import type { RunFunction, PluginContext, ToolDescriptor } from "@aicontainer/ragents";
import type { PluginModule } from "../../apps/server/src/plugin-support/plugin-module.js";

export function corePluginIds(repoRoot: string): string[] {
  const source = ts.createSourceFile("core.ts", readFileSync(path.join(repoRoot, "ragents.config.core.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  const arrays: ts.ArrayLiteralExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "PLUGINS") {
      if (!ts.isArrayLiteralExpression(node.initializer)) throw new Error("core.PLUGINS muss eine literale Liste sein.");
      arrays.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (arrays.length !== 1) throw new Error("Genau eine core.PLUGINS-Liste erwartet.");
  const ids = arrays[0].elements.map((entry) => {
    if (!ts.isStringLiteral(entry) || !/^ragents\.[a-z][a-z0-9-]*$/.test(entry.text)) throw new Error("Das öffentliche core-Profil enthält einen nicht freigegebenen Plugin-Verweis.");
    return entry.text;
  });
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error("Leere oder doppelte core-Plugins.");
  return ids;
}

export function assertPublicOutput(text: string): void {
  if (/plugins\/(?!ragents\.)[a-z]|\/Users\/|\/private\/|\/tmp\/|OPENROUTER_VSCODE_APIKEY/i.test(text)) {
    throw new Error("Die öffentliche Referenz enthält einen privaten Namen, lokalen Pfad oder Konfigurationsverweis.");
  }
}

export function publicPackageFiles(directory: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (relative: string) => {
    for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) files[name] = readFileSync(path.join(directory, name), "utf8");
      else throw new Error(`Ungültiger Dateityp im öffentlichen Run-Script: ${name}`);
    }
  };
  visit("");
  return files;
}

async function collect(repoRoot: string) {
  globalThis.fetch = async () => { throw new Error("Referenzgenerierung darf keine Netzaufrufe ausführen."); };
  const { composeProfile } = await import("../../apps/server/src/profile/compose.js");
  const { agentTools, modelToolDescriptors } = await import("@aicontainer/ragents");
  const { actorProgramAuthoringContracts } = await import("../../plugins/ragents.actor-programs/server/authoring-contracts.js");
  const { serverApiDeclarations } = await import("../../plugins/ragents.actor-programs/server/app-project.js");
  const { runModuleTemplates } = await import("../../plugins/ragents.actor-programs/server/templates.js");
  const ids = corePluginIds(repoRoot);
  const modules = new Map<string, PluginModule>();
  for (const id of ids) {
    const { plugin: module } = await import(pathToFileURL(path.join(repoRoot, "plugins", id, "server/index.ts")).href) as { plugin: PluginModule };
    if (!module || typeof module.create !== "function" || module.requires?.some((required) => !ids.includes(required))) throw new Error(`Ungültiger öffentlicher Plugin-Vertrag: ${id}`);
    modules.set(id, module);
  }
  const workspace = process.env.DATA_DIR!;
  const host = composeProfile({ product: { id: "ragents", title: "RAgents" }, pluginIds: ids, modules }, {
    ensureSession: () => { throw new Error("Referenzgenerierung darf keine Runs anlegen."); },
    runtime: () => { throw new Error("Referenzgenerierung darf keine Laufzeit starten."); },
    sessionWorkspaceFor: async () => ({ cwd: workspace, currentRoot: async () => workspace, ensureWritable: async () => workspace, runOperation: async <T>(operation: () => Promise<T>) => operation() }),
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
    if (!descriptor) throw new Error(`Werkzeugbeschreibung fehlt: ${tool.name}`);
    return entry(tool, descriptor, "engine");
  });
  const descriptors = host.tools.describe();
  const dynamic: string[] = [];
  for (const contributor of host.tools.entries()) {
    if (contributor.dynamic) { dynamic.push(contributor.name); continue; }
    const resolved = await contributor.tools(context);
    if (resolved.length !== contributor.descriptors.length) throw new Error(`Unvollständiger Werkzeugbeitrag: ${contributor.name}`);
    for (const tool of resolved) {
      const descriptor = descriptors.find((item) => item.source === contributor.name && item.name === tool.name);
      if (!descriptor || descriptor.description !== tool.description || !tool.schema || !tool.resultSchema) throw new Error(`Abweichender Werkzeugvertrag: ${tool.name}`);
      tools.push(entry(tool, descriptor, descriptor.owner));
    }
  }
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) throw new Error("Doppelte Werkzeugnamen.");
  return {
    plugins: host.publicManifests().map(({ id, requires }) => ({ id, requires })),
    tools: tools.sort((a, b) => a.name.localeCompare(b.name, "en")),
    operations: host.operations.describe(),
    starts: host.startEntries.describe(),
    scripts: host.startEntries.describe().filter((start) => start.action === "script").map((start) => {
      const script = host.startEntries.scriptPackage(start.id);
      if (!script) throw new Error(`Run-Script fehlt: ${start.id}`);
      const files = publicPackageFiles(path.join(repoRoot, "plugins", start.owner, "run-scripts", script.handle));
      if (!files["package.json"] || !files["RUN.md"] || !Object.keys(files).some((name) => /^tests\/.*\.test\.ts$/.test(name))) {
        throw new Error(`Unvollständige Paketquellen: ${start.id}`);
      }
      return { id: start.id, files };
    }),
    serverApiDeclarations: serverApiDeclarations(tools.filter((tool) => !["typescript_api", "typescript_eval"].includes(tool.name)).map((tool) => ({ ...tool, id: tool.name }))),
    actorProgramAuthoring: actorProgramAuthoringContracts(),
    clientUiFiles: readHomepageUiContracts(repoRoot).files,
    templates: runModuleTemplates,
    dynamic: dynamic.sort(),
  };
}

export type HomepageCatalog = Awaited<ReturnType<typeof collect>>;

if (process.argv.includes("--collect")) {
  const output = JSON.stringify(await collect(path.resolve(import.meta.dirname, "../..")));
  assertPublicOutput(output);
  process.stdout.write(output);
}
