import "../host-resolution.js";
import { statSync } from "node:fs";
import path from "node:path";
import { loadConfigFile } from "../config-file.js";
import { webEntryOf } from "../plugin-support/plugins-root.js";
import { resolvePluginEntries } from "./plugin-discovery.js";

const hasFolder = (folder: string, name: string): boolean =>
  statSync(path.join(folder, name), { throwIfNoEntry: false })?.isDirectory() === true;

/** Prints the profile's plugins as JSON for build scripts: id, folder and whether a web half exists. */
await loadConfigFile();
const { config } = await import("../config.js");
const plugins = resolvePluginEntries(config.plugins).map((plugin) => ({
  ...plugin,
  web: webEntryOf(plugin.folder),
  install: statSync(path.join(plugin.folder, "install.sh"), { throwIfNoEntry: false })?.isFile() === true,
  clientUi: hasFolder(plugin.folder, "client-ui"),
}));
console.log(JSON.stringify(plugins));
