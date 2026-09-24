import { mkdir } from "node:fs/promises";
import { hostDataDirectory, pluginToolsDirectory } from "@ragents/workspace-executor/src/tools.ts";
import { isPluginProvision, type PluginProvision } from "../plugin-support/provision.js";
import { importBundles, resolvePluginEntries, type ResolvedPlugin } from "./plugin-discovery.js";

/** Die Plugins, deren Werkzeuge jeder Arbeitsplatz-Executor auf seiner Maschine braucht: Sprachserver und Browser. */
export const WORKSPACE_PROVISION_PLUGINS = ["ragents.lsp-roslyn", "ragents.lsp-fsharp", "ragents.browser"] as const;

/** The provisioning a bundle exports next to its plugin, if it brings one. */
const provisionOf = (plugin: ResolvedPlugin, exported: Readonly<Record<string, unknown>>): PluginProvision | undefined => {
  if (exported.provision === undefined) return undefined;
  if (!isPluginProvision(exported.provision)) {
    throw new Error(`Das Bundle ${plugin.id} exportiert eine ungültige Provisionierung; erwartet wird "export const provision: PluginProvision" mit check und apply`);
  }
  return exported.provision;
};

export type ProvisionOutcome = "ready" | "installed" | "missing";

export interface PluginProvisionReport {
  readonly id: string;
  readonly target: string;
  readonly outcome: ProvisionOutcome;
  readonly reason?: string;
}

export const provisionReportLine = (report: PluginProvisionReport): string =>
  `${report.id}: ${report.outcome === "ready" ? "bereit" : report.outcome === "installed" ? "installiert" : `fehlt: ${report.reason ?? "ohne Grund"}`}`;

const reason = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const provisionPlugin = async (
  plugin: ResolvedPlugin,
  provision: PluginProvision,
  dataDirectory: string,
  log: (line: string) => void,
): Promise<PluginProvisionReport> => {
  const target = pluginToolsDirectory(dataDirectory, plugin.id);
  try {
    const state = await provision.check(target);
    if (state.kind === "ready") return { id: plugin.id, target, outcome: "ready" };
    if (!state.installable) return { id: plugin.id, target, outcome: "missing", reason: state.instruction };
    await mkdir(target, { recursive: true });
    await provision.apply(target, (line) => log(`   ${line}`));
    const after = await provision.check(target);
    if (after.kind === "ready") return { id: plugin.id, target, outcome: "installed" };
    return { id: plugin.id, target, outcome: "missing", reason: after.instruction };
  } catch (cause) {
    return { id: plugin.id, target, outcome: "missing", reason: reason(cause) };
  }
};

/** Provisioniert jedes Plugin, dessen Bundle eine Provisionierung exportiert, in seinen Werkzeugordner unterhalb des Datenordners. */
export const provisionPlugins = async (
  plugins: readonly ResolvedPlugin[],
  dataDirectory: string,
  log: (line: string) => void,
): Promise<readonly PluginProvisionReport[]> => {
  const exported = await importBundles(plugins);
  const reports: PluginProvisionReport[] = [];
  for (const plugin of plugins) {
    const provision = provisionOf(plugin, exported.get(plugin.id) ?? {});
    if (!provision) continue;
    const report = await provisionPlugin(plugin, provision, dataDirectory, log);
    log(provisionReportLine(report));
    reports.push(report);
  }
  return reports;
};

/** Die genannten eingebauten Bundles samt allen, deren Exporte sie importieren; ohne diese lädt ein Bundle nicht. */
const withUsedBundles = (ids: readonly string[]): readonly ResolvedPlugin[] => {
  const resolved = new Map<string, ResolvedPlugin>();
  const visit = (id: string): void => {
    if (resolved.has(id)) return;
    const [plugin] = resolvePluginEntries([id]);
    resolved.set(id, plugin!);
    for (const used of plugin!.manifest.uses) visit(used);
  };
  for (const id of ids) visit(id);
  return [...resolved.values()];
};

export const provisionWorkspace = (log: (line: string) => void): Promise<readonly PluginProvisionReport[]> =>
  provisionPlugins(withUsedBundles(WORKSPACE_PROVISION_PLUGINS), hostDataDirectory(), log);
