import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertPublicOutput } from "./homepage-catalog.js";
import { homepageGuideFiles } from "./homepage-guide.js";

export const homepageFiles = [
  "index.html", "site.css", "site.js", "scroll-vendor.js",
  "mini-app.html", "mini-app.js", "mini-app.css",
  ...homepageGuideFiles,
] as const;
const sourceBase = "https://github.com/SchlenkR/RAgents/blob/main/";

export function assertHomepageLinks(outputs: ReadonlyMap<string, string | Buffer>): void {
  for (const [name, content] of outputs) {
    if (!name.endsWith(".html")) continue;
    for (const [, href] of String(content).matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;
      const url = new URL(href.replace(/&amp;/g, "&"), `https://homepage.invalid/${name}`);
      const target = decodeURIComponent(url.pathname.slice(1));
      const body = outputs.get(target);
      if (body === undefined) throw new Error(`Fehlendes Homepage-Linkziel in ${name}: ${href}`);
      if (target.endsWith(".html") && url.hash.length > 1) {
        const id = decodeURIComponent(url.hash.slice(1));
        const ids = new Set([...String(body).matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
        if (!ids.has(id)) throw new Error(`Fehlendes Homepage-Sprungziel in ${name}: ${href}`);
      }
    }
  }
}

export async function buildHomepageExport(repoRoot: string): Promise<Map<string, string | Buffer>> {
  const homepageRoot = path.join(repoRoot, "docs/homepage");
  const outputs = new Map<string, string | Buffer>();
  const screenshots = new Set<string>();
  const published = new Set<string>(homepageFiles);

  function rewrite(value: string, document: string, asset: boolean): string {
    if (!value || value.startsWith("#") || value.startsWith("data:")) return value;
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) {
      if (asset) throw new Error(`Externe Ressource in ${document}: ${value}`);
      return value;
    }
    if (value.startsWith("/")) throw new Error(`Absoluter Homepage-Pfad in ${document}: ${value}`);
    const suffixOffset = value.search(/[?#]/);
    const pathname = suffixOffset < 0 ? value : value.slice(0, suffixOffset);
    const suffix = suffixOffset < 0 ? "" : value.slice(suffixOffset);
    const target = path.posix.normalize(path.posix.join("docs/homepage", path.posix.dirname(document), decodeURIComponent(pathname)));
    if (target.startsWith("docs/homepage/")) {
      const local = target.slice("docs/homepage/".length);
      assertPublicOutput(local);
      if (/^screenshots\/.+\.(?:png|jpe?g|webp|gif)$/i.test(local)) screenshots.add(local);
      else if (!published.has(local)) throw new Error(`Nicht veröffentlichte Homepage-Datei in ${document}: ${value}`);
      return value;
    }
    if (asset || target.startsWith("../")) throw new Error(`Ressource außerhalb der Homepage in ${document}: ${value}`);
    assertPublicOutput(target);
    return sourceBase + target.split("/").map(encodeURIComponent).join("/") + suffix;
  }

  function rewriteCss(css: string, document: string): string {
    return css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (_, quote: string, url: string) => `url(${quote}${rewrite(url.trim(), document, true)}${quote})`);
  }

  for (const name of homepageFiles) {
    let content = await readFile(path.join(homepageRoot, name), "utf8");
    assertPublicOutput(content);
    if (name.endsWith(".html")) {
      content = content.replace(/<(a|link|script|img|source|video|audio|iframe)\b[^>]*>/gi, (tag, element: string) => {
        if (/\bsrcset\s*=/i.test(tag)) throw new Error(`srcset wird im Homepage-Export noch nicht unterstützt: ${name}`);
        return tag.replace(/\b(href|src|poster)\s*=\s*(["'])(.*?)\2/gi, (_: string, attribute: string, quote: string, value: string) =>
          `${attribute}=${quote}${rewrite(value, name, element.toLowerCase() !== "a")}${quote}`);
      });
      content = content.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css: string) => `<style>${rewriteCss(css, name)}</style>`);
    } else if (name.endsWith(".css")) content = rewriteCss(content, name);
    else if (name.endsWith(".md") || name.endsWith(".txt")) {
      let fence: string | undefined;
      content = content.split("\n").map((line) => {
        const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
        if (marker) {
          if (!fence) fence = marker;
          else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
          return line;
        }
        return fence ? line : line.replace(/(!?\[[^\]\n]*\]\()([^\s)]+)(\))/g,
          (_, start: string, value: string, end: string) => start + rewrite(value, name, start.startsWith("!")) + end);
      }).join("\n");
    }
    outputs.set(name, content);
  }
  for (const name of [...screenshots].sort()) {
    const source = path.join(homepageRoot, name);
    const relative = path.relative(await realpath(homepageRoot), await realpath(source));
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Screenshot liegt außerhalb der Homepage: ${name}`);
    outputs.set(name, await readFile(source));
  }
  return outputs;
}

export async function writeHomepageExport(repoRoot: string, outputs: Map<string, string | Buffer>): Promise<void> {
  const destination = path.join(repoRoot, "docs/homepage/dist");
  await rm(destination, { recursive: true, force: true });
  for (const [name, content] of outputs) {
    const file = path.join(destination, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
}
