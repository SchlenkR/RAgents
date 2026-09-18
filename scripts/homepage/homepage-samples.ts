import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import { buildTailwind } from "../../plugins/ragents.actor-programs/server/tailwind.js";

export const homepageSamples = [
  { id: "word-game", title: "Wortspiel" },
  { id: "learning-afternoon", title: "Lernnachmittag" },
] as const;

export async function buildHomepageSamples(repoRoot: string): Promise<Map<string, string>> {
  const webRequire = createRequire(path.join(repoRoot, "apps/web/package.json"));
  const outputs = new Map<string, string>();
  for (const { id, title } of homepageSamples) {
    const sampleSource = `plugins/ragents.reference/run-scripts/${id}/src`;
    const entrySource = `docs/homepage/${id}-preview.tsx`;
    const assertSource = (input: string) => {
      const relative = path.relative(repoRoot, path.resolve(repoRoot, input)).replaceAll(path.sep, "/");
      const allowed = [entrySource, "docs/homepage/sample-preview.tsx", "docs/homepage/preview-size.ts"].includes(relative)
        || ["view.tsx", "state.ts", "workflow.ts"].some(name => relative === `${sampleSource}/${name}`)
        || relative.startsWith("plugins/ragents.actor-programs/client-ui/")
        || relative === "plugins/ragents.actor-programs/workflow/index.ts"
        || relative.startsWith("apps/web/src/chat/") || relative.startsWith("apps/web/src/ui/")
        || ["apps/web/src/SourceCode.tsx", "apps/web/src/DiffCode.tsx", "apps/web/src/highlighting.ts", "apps/web/src/highlighting.css", "apps/web/src/diff-view.css", "apps/web/src/Toolbar.tsx", "apps/server/src/chat-events.ts", "apps/server/src/chat-attachments.ts"].includes(relative)
        || relative.startsWith("node_modules/") || relative.startsWith("apps/web/node_modules/");
      if (!allowed) throw new Error(`Die Sample-Vorschau importiert eine nicht freigegebene Quelle: ${relative}`);
    };
    const result = await build({
      absWorkingDir: repoRoot,
      entryPoints: [entrySource],
      outdir: "docs/homepage",
      entryNames: id,
      bundle: true,
      write: false,
      metafile: true,
      platform: "browser",
      format: "iife",
      target: "es2022",
      supported: { "template-literal": false },
      jsx: "automatic",
      minify: true,
      charset: "utf8",
      legalComments: "eof",
      define: { "process.env.NODE_ENV": '"production"' },
      alias: {
        "react-dom/client": webRequire.resolve("react-dom/client"),
        "react-dom": webRequire.resolve("react-dom"),
        "@ragents/client/ui": path.join(repoRoot, "plugins/ragents.actor-programs/client-ui/index.tsx"),
      },
      plugins: [{ name: "public-homepage-sample", setup(builder) {
        builder.onLoad({ filter: /.*/, namespace: "file" }, input => { assertSource(input.path); return undefined; });
      } }],
    });
    const inputs = Object.keys(result.metafile.inputs);
    for (const input of inputs) assertSource(input);
    for (const required of [entrySource, `${sampleSource}/view.tsx`]) {
      if (!inputs.includes(required)) throw new Error(`Die Sample-Vorschau verwendet die Originalquelle nicht: ${required}`);
    }
    const javascript = result.outputFiles.find(file => file.path.endsWith(".js"))?.text;
    const css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text;
    if (!javascript || !css) throw new Error(`Die Sample-Vorschau ${id} benötigt JavaScript und CSS.`);
    const tailwind = await buildTailwind([path.join(repoRoot, sampleSource), { base: path.join(repoRoot, "docs/homepage"), pattern: "*.tsx" }]);
    outputs.set(`${id}.html`, `<!doctype html>
<html lang="de" data-ui-surface="mini-app">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="connect-src 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - Sample-Vorschau</title>
<link rel="stylesheet" href="${id}.css">
<script src="${id}.js" defer></script>
</head>
<body>
<p class="sample-preview-notice">Vorschau mit Beispieldaten.</p>
<main id="root"><p>Die Vorschau benötigt JavaScript. Das Sample mit Quellen steht in der <a href="reference.html#start-ragents.reference.${id}" target="_top">Referenz</a>.</p></main>
</body>
</html>
`);
    outputs.set(`${id}.js`, javascript);
    outputs.set(`${id}.css`, tailwind + css + "\nhtml, body { height: auto; min-height: 0; } body { margin: 0; padding: 14px; display: flow-root; } .sample-preview-notice { margin: 0 0 12px; color: var(--muted-foreground); font-size: 12px; line-height: 1.4; } .sample-preview-controls { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 14px; }\n");
  }
  return outputs;
}
