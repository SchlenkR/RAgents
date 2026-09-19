import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const apiTarget = process.env.API_TARGET ?? "http://localhost:4710";
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const hostEntry = path.join(repositoryRoot, "apps/web/src/main.tsx");
const pluginEntriesModule = "virtual:ragents-plugins";

interface BundledPlugin {
  readonly id: string;
  readonly folder: string;
  readonly web: string | undefined;
}

const webEntryOf = (folder: string): string | undefined =>
  ["web/index.ts", "web/index.tsx"].map((name) => path.join(folder, name))
    .find((candidate) => statSync(candidate, { throwIfNoEntry: false })?.isFile() === true);

const repositoryPlugins = (): BundledPlugin[] => {
  const root = path.join(repositoryRoot, "plugins");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ id: entry.name, folder: path.join(root, entry.name), web: webEntryOf(path.join(root, entry.name)) }));
};

/** The profile's plugins as the server resolves them; the last stdout line carries the JSON. */
const profilePlugins = (): BundledPlugin[] => {
  if (!process.env.PRODUCT_PROFILE) return [];
  const output = execFileSync("node", ["--import", "tsx", "src/profile/plugin-list.ts"], {
    cwd: path.join(repositoryRoot, "apps/server"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(output.trim().split("\n").at(-1) ?? "[]") as BundledPlugin[];
};

/** Bundles the repository's plugins and, with a profile, its plugins from anywhere on disk. */
const bundledPlugins = (): BundledPlugin[] => {
  const plugins = repositoryPlugins();
  for (const plugin of profilePlugins()) {
    const known = plugins.find((candidate) => candidate.id === plugin.id);
    if (known && known.folder !== plugin.folder) {
      throw new Error(`Das Plugin ${plugin.id} liegt unter ${known.folder} und ${plugin.folder}`);
    }
    if (!known) plugins.push(plugin);
  }
  return plugins;
};

const isBareSpecifier = (specifier: string): boolean =>
  !/^(\.{1,2}\/|\/|\0|[a-z][a-z0-9+.-]*:)/i.test(specifier);

const ragentsPlugins = (plugins: readonly BundledPlugin[]): Plugin => {
  const external = plugins.filter((plugin) => !plugin.folder.startsWith(repositoryRoot));
  const withWeb = plugins.filter((plugin) => plugin.web !== undefined);
  return {
    name: "ragents-plugins",
    enforce: "pre",
    config: () => ({
      resolve: {
        alias: {
          "@aicontainer/ragents/src": path.join(repositoryRoot, "packages/ragents/src"),
          "@aicontainer/server": path.join(repositoryRoot, "apps/server/src"),
          "@aicontainer/web": path.join(repositoryRoot, "apps/web/src"),
          "@aicontainer/plugins": path.join(repositoryRoot, "plugins"),
        },
      },
      server: { fs: { allow: [repositoryRoot, ...external.map((plugin) => plugin.folder)] } },
    }),
    resolveId(source, importer) {
      if (source === pluginEntriesModule) return `\0${pluginEntriesModule}`;
      if (!importer || importer.startsWith(repositoryRoot) || !isBareSpecifier(source)) return null;
      return this.resolve(source, hostEntry, { skipSelf: true });
    },
    load(id) {
      if (id !== `\0${pluginEntriesModule}`) return null;
      const entries = withWeb.map((plugin) => `  ${JSON.stringify(plugin.id)}: () => import(${JSON.stringify(plugin.web)}),`);
      return `export const webPluginEntries = {\n${entries.join("\n")}\n};\n`;
    },
    transform(code, id) {
      if (!id.endsWith("/apps/web/src/ui/tailwind.css") || external.length === 0) return null;
      const sources = external.flatMap((plugin) => [
        `@source ${JSON.stringify(path.join(plugin.folder, "web/**/*"))};`,
        `@source ${JSON.stringify(path.join(plugin.folder, "client-ui/**/*"))};`,
      ]);
      return `${code}\n${sources.join("\n")}\n`;
    },
  };
};

export default defineConfig({
  plugins: [ragentsPlugins(bundledPlugins()), react(), tailwindcss(), {
    name: "ragents-help",
    apply: "build",
    buildStart() {
      execFileSync("bash", [path.join(repositoryRoot, "build/homepage.sh")], { cwd: repositoryRoot, stdio: "inherit" });
    },
    async generateBundle() {
      const directory = path.join(repositoryRoot, "docs/homepage/dist");
      const include = async (relative: string): Promise<void> => {
        for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
          const name = path.posix.join(relative, entry.name);
          if (entry.isDirectory()) await include(name);
          else this.emitFile({ type: "asset", fileName: `help/${name}`, source: await readFile(path.join(directory, name)) });
        }
      };
      await include("");
    },
  }],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        column: fileURLToPath(new URL("column.html", import.meta.url)),
      },
    },
  },
  server: {
    port: 5710,
    strictPort: true,
    proxy: {
      "/api": apiTarget,
      "/chat": apiTarget,
      "/plugin-assets": apiTarget,
      "/ragents": apiTarget,
      "/help": apiTarget,
    },
  },
});
