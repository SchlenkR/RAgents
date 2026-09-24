import { build } from "esbuild";

export async function buildHomepageMotion(repoRoot: string): Promise<string> {
  const result = await build({
    absWorkingDir: repoRoot,
    stdin: {
      contents: `import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);
window.gsap = gsap;
window.ScrollTrigger = ScrollTrigger;`,
      resolveDir: repoRoot,
      sourcefile: "homepage-scroll.js",
    },
    outfile: "docs/homepage/scroll-vendor.js",
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: "es2022",
    minify: true,
    legalComments: "eof",
  });
  const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  if (!javascript) throw new Error("Das Scroll-Bundle enthält keine JavaScript-Ausgabe.");
  return javascript;
}
