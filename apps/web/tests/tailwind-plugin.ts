import { fileURLToPath } from "node:url";
import type { Plugin } from "esbuild";
import { buildTailwind } from "../../../plugins/ragents.actor-programs/server/tailwind.ts";

export const hostStylesheet = fileURLToPath(new URL("../src/ui/tailwind.css", import.meta.url));
export const frameStylesheet = fileURLToPath(new URL("../src/ui/frame.css", import.meta.url));

/** Lets esbuild fixtures import the Tailwind entries by compiling them over the given source directories. */
export const tailwindPlugin = (sources: readonly string[]): Plugin => ({
  name: "tailwind-fixture",
  setup(build) {
    build.onLoad({ filter: /\/apps\/web\/src\/ui\/(tailwind|frame)\.css$/ }, async (args) => ({
      contents: await buildTailwind(sources, args.path),
      loader: "css",
    }));
  },
});
