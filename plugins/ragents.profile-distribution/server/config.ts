import path from "node:path";
import { configFilePath } from "@ragents/host/config-file.js";
import { declaredEnvironment } from "@ragents/host/plugin-support/plugin-config.js";

export const profileDistributionConfigDescriptors = [
  { key: "CLIENT_PROFILE_FILE", source: "environment" },
  { key: "HOST_VERSION", source: "environment" },
] as const;

const env = declaredEnvironment(profileDistributionConfigDescriptors);

/** Der Pfad gilt relativ zur Server-Profildatei, damit beide Dateien nebeneinander liegen können. */
const resolveClientProfileFile = (): string | undefined => {
  const value = env.optional("CLIENT_PROFILE_FILE");
  if (!value) return undefined;
  const profile = configFilePath();
  return path.resolve(profile ? path.dirname(profile) : process.cwd(), value);
};

export const profileDistributionConfig = Object.freeze({
  clientProfileFile: resolveClientProfileFile,
  hostVersion: () => {
    const value = env.optional("HOST_VERSION");
    if (value !== undefined && !/^[0-9a-f]{40}$/.test(value)) throw new Error(`HOST_VERSION muss ein vollständiger Git-Commit sein, nicht "${value}"`);
    return value;
  },
});
