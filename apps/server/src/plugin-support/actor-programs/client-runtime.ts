import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

export { FRAME_BODY_CLASS, FRAME_DOCUMENT_CLASS, FRAME_ROOT_CLASS } from "../../../../web/src/actor-programs/client-ui/frame-layout.js";

/** Third-party stylesheets every mini-app frame needs: syntax colors, diff markup and the flow diagram. */
const entries = ["../../highlighting.css", "../../diff-view.css", "./flow-diagram.css"];

export const browserRuntimeStyles = buildSync({
  stdin: {
    contents: entries.map((file) => `@import "${file}";`).join("\n"),
    resolveDir: fileURLToPath(new URL("../../../../web/src/actor-programs/client-ui/", import.meta.url)),
    loader: "css",
  },
  bundle: true,
  write: false,
  minify: true,
}).outputFiles[0].text;

export const browserInputRuntime = buildSync({
  entryPoints: [fileURLToPath(new URL("../../../../web/src/run-panel/input-bridge.ts", import.meta.url))],
  bundle: true,
  write: false,
  minify: true,
  format: "iife",
  globalName: "ragentsInputBridge",
}).outputFiles[0].text;
