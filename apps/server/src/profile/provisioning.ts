import { mkdir } from "node:fs/promises";
import { hostDataDirectory, pluginToolsDirectory } from "@ragents/workspace-executor/src/tools.ts";
import { isPluginProvision, type PluginProvision } from "../plugin-support/provision.js";
import { discoverPluginIds, importBundles, resolvePluginEntries, type ResolvedPlugin } from "./plugin-discovery.js";

/** The provisioning a bundle exports next to its plugin, if it brings one. */
const provisionOf = (plugin: ResolvedPlugin, exported: Readonly<Record<string, unknown>>): PluginProvision | undefined => {
  if (exported.provision === undefined) return undefined;
  if (!isPluginProvision(exported.provision)) {
    throw new Error(`The bundle ${plugin.id} exports an invalid provisioning; expected is "export const provision: PluginProvision" with check and apply`);
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
  `${report.id}: ${report.outcome === "ready" ? "ready" : report.outcome === "installed" ? "installed" : `missing: ${report.reason ?? "no reason"}`}`;

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

/** Provisions every plugin whose bundle exports a provisioning into its tool folder below the data folder. */
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

/** The named built-in bundles plus all whose exports they import; without those, a bundle does not load. */
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

/** A workstation has no profile; it provisions the built-in plugins of its host that contribute to the executor, because their tools run on it. */
export const workspaceProvisionPlugins = (): readonly ResolvedPlugin[] => withUsedBundles(
  resolvePluginEntries(discoverPluginIds()).filter((plugin) => plugin.manifest.executor !== undefined).map((plugin) => plugin.id));

export const provisionWorkspace = (log: (line: string) => void): Promise<readonly PluginProvisionReport[]> =>
  provisionPlugins(workspaceProvisionPlugins(), hostDataDirectory(), log);
