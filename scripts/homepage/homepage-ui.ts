import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import { buildTailwind } from "../../plugins/ragents.actor-programs/server/tailwind.js";
import { readHomepageUiContracts, type HomepageUiComponent } from "./homepage-ui-contracts.js";
export type { HomepageUiComponent, HomepageUiProp } from "./homepage-ui-contracts.js";

export interface HomepageUiResult {
  html: string;
  javascript: string;
  css: string;
  components: HomepageUiComponent[];
}

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]!));

const showcaseStyles = `
.reference-ui-showcase { color:var(--foreground); font-family:var(--font-sans); }
.reference-ui-notice { padding:16px 20px; border-left:3px solid var(--primary); background:var(--card); }
.reference-ui-example { padding:24px 0; border-top:1px solid var(--border); min-width:0; }
.reference-ui-example h3 { margin:0 0 12px; }
.reference-ui-example > p { font-size:14px; }
.reference-ui-chat { height:360px; border:1px solid var(--border); border-radius:8px; background:var(--card); overflow:hidden; }
.reference-ui-messages { height:180px; margin-top:16px; border:1px solid var(--border); border-radius:8px; overflow:hidden; }
.reference-ui-label { display:block; margin-bottom:8px; font-size:14px; }
.reference-ui-example textarea { box-sizing:border-box; max-width:100%; }
#reference-markdown { display:block; width:100%; padding:12px; border:1px solid var(--border); border-radius:8px; background:var(--background); color:var(--foreground); font:14px/1.5 var(--font-mono); resize:vertical; }
.reference-ui-markdown { padding:16px 20px; border:1px solid var(--border); margin-top:16px; overflow-wrap:anywhere; }
.reference-ui-reset { margin-top:12px; }
.reference-ui-controls { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-top:12px; }
.reference-ui-selection { margin-top:12px; }
.reference-ui-props { overflow-x:auto; }
.reference-ui-props table { width:100%; border-collapse:collapse; font-size:14px; }
.reference-ui-props th,.reference-ui-props td { padding:10px 12px; text-align:left; border-bottom:1px solid var(--border); vertical-align:top; }
.reference-ui-props code { white-space:normal; overflow-wrap:anywhere; }
.reference-ui-component { margin:20px 0; }
.reference-ui-component summary { cursor:pointer; padding:12px 0; }
.reference-ui-variant { font-size:15px; margin:20px 0 8px; }
`;

export async function buildHomepageUi(repoRoot: string): Promise<HomepageUiResult> {
  const { components } = readHomepageUiContracts(repoRoot);
  const webRequire = createRequire(path.join(repoRoot, "apps/web/package.json"));
  const assertPublicSource = (input: string) => {
    const relative = path.relative(repoRoot, path.resolve(repoRoot, input)).replaceAll(path.sep, "/");
    const allowed = relative === "docs/homepage/reference-ui.tsx"
      || relative === "plugins/ragents.actor-programs/workflow/index.ts"
      || relative === "plugins/ragents.reference/run-scripts/learning-afternoon/src/workflow.ts"
      || relative.startsWith("plugins/ragents.actor-programs/client-ui/")
      || relative.startsWith("apps/web/src/chat/")
      || relative.startsWith("apps/web/src/ui/")
      || ["apps/web/src/SourceCode.tsx", "apps/web/src/DiffCode.tsx", "apps/web/src/highlighting.ts", "apps/web/src/highlighting.css", "apps/web/src/diff-view.css", "apps/web/src/Toolbar.tsx", "apps/server/src/chat-events.ts", "apps/server/src/chat-attachments.ts"].includes(relative)
      || relative.startsWith("node_modules/") || /^apps\/web\/node_modules\//.test(relative);
    if (!allowed) throw new Error(`Die öffentliche UI-Referenz importiert eine nicht freigegebene Quelle: ${relative}`);
  };
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: ["docs/homepage/reference-ui.tsx"],
    outdir: "docs/homepage",
    entryNames: "reference-ui",
    bundle: true,
    write: false,
    metafile: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    supported: { "template-literal": false },
    jsx: "automatic",
    minify: true,
    legalComments: "eof",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "react-dom/client": webRequire.resolve("react-dom/client"), "react-dom": webRequire.resolve("react-dom") },
    plugins: [{
      name: "public-homepage-ui",
      setup(builder) {
        builder.onLoad({ filter: /.*/, namespace: "file" }, (input) => {
          assertPublicSource(input.path);
          return undefined;
        });
      },
    }],
  });
  for (const input of Object.keys(result.metafile.inputs)) assertPublicSource(input);
  const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const styles = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
  if (!javascript || !styles) throw new Error("Das UI-Bundle enthält nicht beide erwarteten Ausgaben.");
  const licensedJavascript = javascript.replace(/(\n\/\*! Bundled license information:\n[\s\S]*\*\/\n?)$/, (comment) => comment.replace(/[ \t]+$/gm, ""));
  const html = `<div id="ui-showcase"><p>Die lokale UI-Demo wird geladen. JavaScript muss dafür aktiviert sein.</p></div>
<div class="reference-ui-contracts"><h3>Komponenten und Props</h3><p>Automatisch aus dem öffentlichen TypeScript-Vertrag abgeleitet. Geerbte Eigenschaften und Varianten sind eingeschlossen. Eine Eigenschaft mit dem Typ <code>never</code> darf in dieser Variante nicht gesetzt werden.</p>${components.map((component) => `
<details class="reference-ui-component"><summary><code>UI.${escape(component.name)}</code></summary>${component.description ? `<p>${escape(component.description)}</p>` : ""}<p>${component.hasDemo ? "Lokale Demo oben vorhanden." : "Referenz vorhanden, noch keine Demo."}</p>${component.variants.map((variant) => `<h4 class="reference-ui-variant">${escape(variant.name === "__type" ? `${component.name}Props` : variant.name)}</h4><div class="reference-ui-props"><table><thead><tr><th>Prop</th><th>Typ</th><th>Pflicht</th></tr></thead><tbody>${variant.props.map((prop) => `<tr><td><code>${escape(prop.name)}</code></td><td><code>${escape(prop.type)}</code>${prop.description ? `<p>${escape(prop.description)}</p>` : ""}</td><td>${prop.optional ? "nein" : "ja"}</td></tr>`).join("")}</tbody></table></div>`).join("")}</details>`).join("")}</div>`;
  const tailwind = await buildTailwind([{ base: path.join(repoRoot, "docs/homepage"), pattern: "*.tsx" }]);
  return { html, javascript: licensedJavascript, css: tailwind + styles + showcaseStyles, components };
}
