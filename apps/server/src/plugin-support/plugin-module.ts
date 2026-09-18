import type { PluginHost, RAgentsPlugin } from "@aicontainer/ragents";

export interface PluginModule {
  readonly requires?: readonly string[];
  readonly create: (host: PluginHost) => RAgentsPlugin;
}

export const isPluginModule = (value: unknown): value is PluginModule => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as PluginModule;
  if (typeof candidate.create !== "function") return false;
  if (candidate.requires === undefined) return true;
  return Array.isArray(candidate.requires) && candidate.requires.every((id) => typeof id === "string");
};
