import { fileURLToPath } from "node:url";

export const pluginAssetPath = (moduleUrl: string, relativePath: string): string =>
  fileURLToPath(new URL(relativePath, moduleUrl));
