import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { assertPublicOutput, type HomepageCatalog } from "./homepage-catalog.js";
import { buildHomepageMotion } from "./homepage-motion.js";
import { buildHomepageMiniApp } from "./homepage-mini-app.js";
import { buildHomepageLlms } from "./homepage-llms.js";
import { assertHomepageLinks, buildHomepageExport, writeHomepageExport } from "./homepage-export.js";
import { buildHomepageGuide, guideChapterHtml, guideCss, guideIndexHtml } from "./homepage-guide.js";
import { assertHomepageStructure } from "./homepage-structure.js";
import { buildTailwind } from "../../apps/server/src/plugin-support/actor-programs/tailwind.js";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
const css = `
*{box-sizing:border-box}body{margin:0;background:var(--app);color:var(--foreground);font:16px/1.65 var(--font-sans)}a{color:#1467b0;text-underline-offset:4px}a:hover{color:var(--foreground)}:focus-visible{outline:3px solid var(--primary);outline-offset:4px}main,body>footer{padding-block:24px}nav{display:flex;gap:12px 24px;flex-wrap:wrap}h1{font-size:clamp(38px,7vw,66px);line-height:1.1;letter-spacing:-.04em;margin:16px 0 24px}h2{font-size:30px;line-height:1.2;margin:0 0 20px;letter-spacing:-.02em}h3{font-size:20px;line-height:1.4}p{max-width:76ch}.intro{padding:36px 0 44px}.eyebrow{font:12px var(--font-mono);text-transform:uppercase;letter-spacing:.1em}.lead{font-size:20px;line-height:1.6}.stats{font:13px var(--font-mono);margin:24px 0}.section-nav{border-top:1px solid var(--border);padding:20px 0}main>section{padding:44px 0;border-top:1px solid var(--border)}article{min-width:0;padding:24px 0;border-top:1px solid var(--border-soft)}article h3{margin:0 0 8px;overflow-wrap:anywhere}.meta,.example-context{font:12px/1.7 var(--font-mono);color:#536b80;overflow-wrap:anywhere}details{margin:14px 0;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--background)}summary{cursor:pointer;padding:12px 16px;font-weight:600}details>p,details>div,details>table{margin:16px}pre{max-width:100%;overflow:auto;padding:20px;background:var(--card);font:12px/1.7 var(--font-mono);tab-size:2;margin:0}code{font-family:var(--font-mono);font-size:.9em;overflow-wrap:anywhere}pre code{font-size:inherit;overflow-wrap:normal}label{display:block;font-weight:600;margin-bottom:6px}input[type=search],select{font:inherit;color:inherit;border:1px solid var(--border);border-radius:6px;background:var(--background);padding:10px 12px;max-width:100%}input[type=search]{width:100%}.tool-label{display:block;font-size:13px;font-weight:400;color:#536b80;margin-top:3px}[data-tool]{padding:0;border:0}[data-tool]>details{margin:8px 0}[data-tool]>details>a{display:inline-block;margin:0 16px 16px}[data-tool]>details>details{margin:16px}.filter-row{display:flex;gap:16px;flex-wrap:wrap;align-items:end}.filter-row>div:first-child{flex:1;min-width:min(280px,100%)}.note{padding:16px 20px;background:var(--card);border-left:3px solid var(--primary)}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--border);padding:10px;overflow-wrap:anywhere}th{font-weight:600}.table-wrap{overflow:auto}body>footer{padding-top:30px;padding-bottom:60px;border-top:1px solid var(--border)}[hidden]{display:none!important}@media(max-width:600px){h2{font-size:26px}main>section{padding:32px 0}pre{padding:14px;font-size:11px}.lead{font-size:18px}}
`;

function page(header: string, title: string, body: string, tokens: string, script = "", extraCss = "", markdownFile?: string) {
  return `<!doctype html>\n<html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${escape(title)}: public documentation for RAgents."><title>${escape(title)} - RAgents</title>${markdownFile ? `<link rel="alternate" type="text/markdown" href="${escape(markdownFile)}">` : ""}<style>${tokens}\n${css}</style>${extraCss}<link rel="stylesheet" href="site.css"><script src="site.js" defer></script></head><body><a class="skip" href="#main">Skip to content</a>${header}<main class="shell" id="main">${body}</main><footer class="shell"><p>Generated from public documentation. Rebuild with <code>pnpm generate:homepage</code>. Verify with <code>pnpm check:homepage</code>.</p><nav aria-label="More pages"><a href="index.html">Homepage</a><a href="guide.html">Guide</a></nav></footer>${script}</body></html>\n`;
}

async function main() {
  const check = process.argv.includes("--check");
  if (process.argv.slice(2).some((arg) => arg !== "--check")) throw new Error("Aufruf: generate-homepage.ts [--check]");
  const scratch = await mkdtemp(path.join(tmpdir(), "ragents-reference-"));
  try {
    const require = createRequire(path.join(repoRoot, "apps/server/package.json"));
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", require.resolve("tsx"), path.join(repoRoot, "scripts/homepage/homepage-catalog.ts"), "--collect"], {
      cwd: repoRoot, env: { PATH: process.env.PATH, DATA_DIR: scratch, PRODUCT_PROFILE: "showcase", PRODUCT_ID: "ragents", PRODUCT_TITLE: "RAgents", AGENT_MODEL: "z-ai/glm-5.3-flash", AGENT_COORDINATOR_MODEL: "z-ai/glm-5.3", OPENROUTER_API_KEY: "documentation-only" },
      maxBuffer: 16 * 1024 * 1024, timeout: 60000,
    });
    const catalog = JSON.parse(stdout) as HomepageCatalog;
    const motion = await buildHomepageMotion(repoRoot);
    const miniApp = await buildHomepageMiniApp(repoRoot);
    const tokens = await buildTailwind([], path.join(repoRoot, "apps/web/src/ui/theme.css"));
    const { buildHomepageExtensions } = await import("./homepage-extensions.js");
    const extensions = await buildHomepageExtensions(repoRoot);
    const guide = await buildHomepageGuide(repoRoot);
    const homepage = await readFile(path.join(repoRoot, "docs/homepage/index.html"), "utf8");
    const structure = assertHomepageStructure(homepage);
    for (const { id, guide: target } of structure.features) {
      const chapter = /^guide-([a-z-]+)\.html/.exec(target)![1];
      if (!guide.chapters.some((entry) => entry.id === chapter)) throw new Error(`Core feature ${id} links to an unknown guide chapter: ${target}`);
    }
    const headers = [...homepage.matchAll(/<header class="masthead shell">[\s\S]*?<\/header>/g)];
    if (headers.length !== 1) throw new Error("The homepage must contain exactly one shared header.");
    const header = headers[0][0].replace(/href="#/g, 'href="index.html#');
    const pageHeader = (file: string) => header.replace(`href="${file}"`, `href="${file}" aria-current="page"`);
    const outputs: Record<string, string> = {
      ...buildHomepageLlms(catalog, extensions, guide),
      "guide.html": page(pageHeader("guide.html"), "Guide", guideIndexHtml(), tokens, "", guideCss, "guide.md"),
      ...Object.fromEntries(guide.chapters.map((chapter) => [`guide-${chapter.id}.html`, page(pageHeader("guide.html"), chapter.title, guideChapterHtml(chapter), tokens, "", guideCss, `guide-${chapter.id}.md`)])),
      "scroll-vendor.js": motion,
      ...Object.fromEntries(miniApp),
    };
    for (const output of Object.values(outputs)) assertPublicOutput(output);
    for (const [name, output] of Object.entries(outputs)) {
      const destination = path.join(repoRoot, "docs/homepage", name);
      if (check) {
        if (await readFile(destination, "utf8") !== output) throw new Error(`${name} is outdated. Run pnpm generate:homepage.`);
      } else await writeFile(destination, output);
    }
    const website = await buildHomepageExport(repoRoot);
    assertHomepageLinks(website);
    if (!check) await writeHomepageExport(repoRoot, website);
    console.log(`${check ? "Checked" : "Generated"}: ${Object.keys(outputs).join(", ")}; ${structure.features.length} core features, ${catalog.tools.length} tools, ${extensions.extensions.length} extension points; static website (${website.size} files) in docs/homepage/dist/.`);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

await main();
