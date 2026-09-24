import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import { buildTailwind } from "../../apps/server/src/plugin-support/actor-programs/tailwind.js";

const listSource = "plugins/ragents.reference/run-scripts/shared-actor-list/actors/shared-list/src";
const runtimeSource = "docs/homepage/mini-app-runtime.ts";
const uiSource = "apps/web/src/actor-programs/client-ui/index.tsx";
const bridgeNamespace = "homepage-mini-app";

const html = `<!doctype html>
<html lang="en" data-ui-frame="mini-app">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="connect-src 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shared list - local mini-app demo</title>
<link rel="stylesheet" href="mini-app.css">
<script src="mini-app.js" defer></script>
</head>
<body>
<p class="homepage-mini-app-notice">Local mini-app demo. Input remains on this page.</p>
<main id="root"><p>The mini-app is loading. JavaScript must be enabled.</p></main>
</body>
</html>
`;

const viewportStyles = `
html, body { height:auto; min-height:0; }
body { margin:0; padding:16px; display:flow-root; }
.homepage-mini-app-notice { max-width:720px; margin:0 auto 14px; color:var(--muted-foreground); font-size:12px; line-height:1.4; }
@media (max-width:320px) { body { padding:12px; } }
`;

export async function buildHomepageMiniApp(repoRoot: string): Promise<Map<string, string>> {
  const webRequire = createRequire(path.join(repoRoot, "apps/web/package.json"));
  const relativeSource = (input: string) => path.relative(repoRoot, path.resolve(repoRoot, input)).replaceAll(path.sep, "/");
  const assertPublicSource = (input: string) => {
    if (input.startsWith(`${bridgeNamespace}:`)) return;
    const relative = relativeSource(input);
    const allowed = relative === runtimeSource || relative === "docs/homepage/preview-size.ts"
      || ["client.tsx", "server.ts", "contract.ts"].some((name) => relative === `${listSource}/${name}`)
      || relative.startsWith("apps/web/src/actor-programs/client-ui/")
      || relative === "apps/server/src/plugin-support/actor-programs/workflow/index.ts"
      || relative.startsWith("apps/web/src/chat/")
      || relative.startsWith("apps/web/src/ui/")
      || ["apps/web/src/SourceCode.tsx", "apps/web/src/DiffCode.tsx", "apps/web/src/highlighting.ts", "apps/web/src/highlighting.css", "apps/web/src/diff-view.css", "apps/web/src/Toolbar.tsx", "apps/server/src/chat-events.ts", "apps/server/src/chat-attachments.ts"].includes(relative)
      || relative.startsWith("node_modules/") || relative.startsWith("apps/web/node_modules/");
    if (!allowed) throw new Error(`Die öffentliche Mini-App-Demo importiert eine nicht freigegebene Quelle: ${relative}`);
  };
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: ["homepage-mini-app:entry"],
    outdir: "docs/homepage",
    entryNames: "mini-app",
    bundle: true,
    write: false,
    metafile: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    legalComments: "eof",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "react-dom/client": webRequire.resolve("react-dom/client"), "react-dom": webRequire.resolve("react-dom") },
    plugins: [{
      name: "public-homepage-mini-app",
      setup(builder) {
        builder.onResolve({ filter: /^homepage-mini-app:entry$/ }, () => ({ path: "entry", namespace: bridgeNamespace }));
        builder.onResolve({ filter: /^@ragents\/client$/ }, () => ({ path: "client", namespace: bridgeNamespace }));
        builder.onResolve({ filter: /^@ragents\/server$/ }, () => ({ path: "server", namespace: bridgeNamespace }));
        builder.onResolve({ filter: /^@ragents\/client\/ui$/ }, () => ({ path: path.join(repoRoot, uiSource) }));
        builder.onLoad({ filter: /.*/, namespace: bridgeNamespace }, ({ path: name }) => ({
          contents: name === "entry" ? `
import "./docs/homepage/preview-size.ts";
import "./apps/web/src/actor-programs/client-ui/flow-diagram.css";
import "./${listSource}/client.tsx";`
            : name === "client" ? `
import { createHomepageMiniAppRuntime } from "./${runtimeSource}";
import actor from "./${listSource}/server.ts";
export const { context, useAppState } = createHomepageMiniAppRuntime(actor.functions.append);`
              : "export const defineActor = (_contract, implementation) => implementation;",
          resolveDir: repoRoot,
          loader: "js",
        }));
        builder.onLoad({ filter: /.*/, namespace: "file" }, (input) => {
          assertPublicSource(input.path);
          return undefined;
        });
      },
    }],
  });
  const inputs = Object.keys(result.metafile.inputs);
  for (const input of inputs) assertPublicSource(input);
  for (const source of [runtimeSource, uiSource, "apps/web/src/ui/button.tsx", ...["client.tsx", "server.ts", "contract.ts"].map((name) => `${listSource}/${name}`)]) {
    if (!inputs.includes(source)) throw new Error(`Die Mini-App-Demo verwendet die Originalquelle nicht: ${source}`);
  }
  const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
  if (!javascript || !css) throw new Error("Die Mini-App-Demo enthält nicht beide erwarteten Bundle-Ausgaben.");
  const tailwind = await buildTailwind([path.join(repoRoot, listSource)]);
  return new Map([["mini-app.html", html], ["mini-app.js", javascript.trimEnd() + "\n"], ["mini-app.css", tailwind + css + viewportStyles]]);
}
