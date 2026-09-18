import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

/** Third-party stylesheets every mini-app frame needs: syntax colors, diff markup and the flow diagram. */
const entries = ["../../../apps/web/src/highlighting.css", "../../../apps/web/src/diff-view.css", "./flow-diagram.css"];

export const browserRuntimeStyles = buildSync({
  stdin: {
    contents: entries.map((file) => `@import "${file}";`).join("\n"),
    resolveDir: fileURLToPath(new URL("../client-ui/", import.meta.url)),
    loader: "css",
  },
  bundle: true,
  write: false,
  minify: true,
}).outputFiles[0].text;
