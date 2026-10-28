import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../packages/workspace-executor/package.json", import.meta.url));
const sandboxRoot = path.dirname(require.resolve("@anthropic-ai/sandbox-runtime/package.json"));
const vendor = fileURLToPath(new URL("./dist/vendor", import.meta.url));
await rm(vendor, { recursive: true, force: true });
await mkdir(vendor, { recursive: true });
for (const file of ["seccomp/arm64/apply-seccomp", "seccomp/x64/apply-seccomp", "java-proxy-agent/srt-proxy-agent.jar"]) {
  const target = path.join(vendor, file);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(sandboxRoot, "vendor", file), target);
}
await cp(path.join(sandboxRoot, "LICENSE"), path.join(vendor, "sandbox-runtime-LICENSE"));

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
  define: { "import.meta.url": "__importMetaUrl" },
  banner: { js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
};

if (process.argv.includes("--watch")) {
  const watcher = await context(options);
  await watcher.watch();
} else {
  await build(options);
}
