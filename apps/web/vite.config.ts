import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { rmSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { acquireLock, installFolder } from "../server/src/folder-install.ts";
import { HOST_WEB_RECORD, hostWebDirectory, hostWebRecordOf } from "../server/src/host-web.ts";

const apiTarget = process.env.API_TARGET ?? "http://localhost:4710";
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const outputDirectory = hostWebDirectory(repositoryRoot);
const stagingDirectory = path.join(path.dirname(outputDirectory), `.dist-${process.pid}`);
const buildLock = path.join(path.dirname(outputDirectory), ".dist.lock");

const isFile = (file: string): boolean => statSync(file, { throwIfNoEntry: false })?.isFile() === true;

/** One web for every profile: plugins come as bundles at run time, so the build only knows the host. */
const hostWeb = (): Plugin => ({
  name: "ragents-host-web",
  apply: "build",
  // Parallele Web-Bauten warten aufeinander; ein abgebrochener Bau gibt die Sperre mit seinem Prozess frei.
  async config() {
    await acquireLock(buildLock);
    process.once("exit", () => rmSync(buildLock, { force: true }));
  },
  generateBundle() {
    const sources = [...this.getModuleIds()]
      .map((id) => id.split("?")[0]!)
      .filter((file) => file.startsWith(repositoryRoot) && !file.split(path.sep).includes("node_modules") && isFile(file));
    const record = hostWebRecordOf(repositoryRoot, [...sources, fileURLToPath(import.meta.url), path.join(repositoryRoot, "pnpm-lock.yaml")]);
    this.emitFile({ type: "asset", fileName: HOST_WEB_RECORD, source: `${JSON.stringify(record, null, 2)}\n` });
  },
  // Vite schreibt neben das fertige Web, dann kommt jede Datei einzeln an ihren Platz; ein laufender Host verliert den Ordner nie.
  async writeBundle() {
    await installFolder(stagingDirectory, outputDirectory, ["index.html", "run-panel.html", HOST_WEB_RECORD]);
  },
  closeBundle() {
    rmSync(stagingDirectory, { recursive: true, force: true });
  },
});

export default defineConfig({
  resolve: {
    alias: {
      "@ragents/engine/src": path.join(repositoryRoot, "packages/ragents/src"),
      "@ragents/host": path.join(repositoryRoot, "apps/server/src"),
      "@ragents/web": path.join(repositoryRoot, "apps/web/src"),
    },
  },
  plugins: [react(), hostWeb(), {
    name: "ragents-help",
    apply: "build",
    buildStart() {
      const script = path.join(repositoryRoot, "build/homepage.sh");
      if (isFile(script)) execFileSync("bash", [script], { cwd: repositoryRoot, stdio: "inherit" });
    },
    async generateBundle() {
      const directory = path.join(repositoryRoot, "docs/homepage/dist");
      if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return;
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
    outDir: stagingDirectory,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        runPanel: fileURLToPath(new URL("run-panel.html", import.meta.url)),
      },
    },
  },
  server: {
    port: 5710,
    strictPort: true,
    proxy: {
      "/rpc": apiTarget,
      "/files": apiTarget,
      "/health": apiTarget,
      "/api": apiTarget,
      "/chat": apiTarget,
      "/plugin-assets": apiTarget,
      "/plugins": apiTarget,
      "/ragents.css": apiTarget,
      "/ragents": apiTarget,
      "/help": apiTarget,
    },
  },
});
