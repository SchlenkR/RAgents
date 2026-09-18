import { build, context } from "esbuild";

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
};

if (process.argv.includes("--watch")) {
  const watcher = await context(options);
  await watcher.watch();
} else {
  await build(options);
}
