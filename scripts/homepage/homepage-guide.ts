import { readFile } from "node:fs/promises";
import path from "node:path";
import { Marked } from "marked";
import { assertPublicOutput } from "./homepage-catalog.js";

export const guideChapters = [
  { id: "ideas", title: "Grundideen", description: "Wie KI, TypeScript und bedienbare Oberflächen zusammenarbeiten.", source: "docs/spec/overview.md", next: "guide-runtime.html", nextLabel: "Actors und Nachrichten verstehen" },
  { id: "runtime", title: "Actors und Nachrichten", description: "Runs, Actors, Nachrichten, Turns und Journal bilden die gemeinsame Laufzeit.", source: "docs/spec/core.md", next: "reference.html#tool-event_subscribe", nextLabel: "Ereignisse abonnieren" },
  { id: "getting-started", title: "Samples starten", description: "Die Grundausstattung starten, ein Sample auswählen und den Ablauf verfolgen.", source: "docs/operations.md", next: "reference.html#samples", nextLabel: "Startbare Samples" },
  { id: "functions", title: "Mit TypeScript arbeiten", description: "Funktionen verbinden, feste Abläufe programmieren und Modelle gezielt einbeziehen.", source: "docs/spec/typescript-platform.md", next: "reference.html#tools", nextLabel: "Funktionen nachschlagen" },
  { id: "programs", title: "Mini-Apps bauen", description: "Actor-Zustand und Funktionen in bedienbaren React-Views zugänglich machen.", source: "docs/spec/run-modules.md", next: "developer.html#extension-run-scripts", nextLabel: "Eigene Abläufe entwickeln" },
  { id: "extensions", title: "Plugins und Skills", description: "Erweiterungen entwickeln: passende Ausführungsform wählen, Verträge und Prompts verbinden, Lebenszyklus und Bedienung prüfen.", source: "docs/spec/plugins.md", next: "developer.html#extension-plugin-module", nextLabel: "Ein Plugin entwickeln" },
  { id: "access", title: "Rechte vergeben", description: "Benutzerrechte, Actor-Grants und die Ausstattung eines Subagenten unterscheiden.", source: "docs/spec/profiles.md", next: "developer.html#access-rights", nextLabel: "Rechte und Verträge nachschlagen" },
] as const;

export const homepageGuideFiles = ["guide.html", "guide.md", ...guideChapters.flatMap(({ id }) => [`guide-${id}.html`, `guide-${id}.md`])];
const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));

function guideLink(href: string, source: string): string {
  if (/^(?:https?:|mailto:|#)/.test(href)) return href;
  if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(href)) throw new Error(`Ungültiger Guide-Link: ${href}`);
  const separator = href.search(/[?#]/);
  const target = separator < 0 ? href : href.slice(0, separator);
  const suffix = separator < 0 ? "" : href.slice(separator);
  return path.posix.relative("docs/homepage", path.posix.join(path.posix.dirname(source), target)) + suffix;
}

function guideMarkdownLinks(markdown: string, source: string): string {
  let fence: string | undefined;
  return markdown.split("\n").map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return line;
    }
    if (fence) return line;
    return line.replace(/(`+)(.*?)\1|(!?\[[^\]\n]*\]\()([^\s)]+)(\))|^( {0,3}\[[^\]]+\]:\s*)(\S+)/g,
      (raw, ticks: string, _code: string, start: string, href: string, end: string, reference: string, target: string) =>
        ticks ? raw : reference ? reference + guideLink(target, source) : start + guideLink(href, source) + end);
  }).join("\n");
}

export function guideExcerpt(markdown: string, id: string): string {
  const chunks: string[] = [];
  let active: string | undefined;
  let chunk: string[] = [];
  let fence: string | undefined;
  for (const line of markdown.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
    }
    const boundary = fence ? null : /^<!-- (\/?)guide:([a-z][a-z-]*) -->$/.exec(line);
    if (!boundary) {
      if (active === id) chunk.push(line);
      continue;
    }
    if (boundary[1]) {
      if (active !== boundary[2]) throw new Error(`Unpassendes Guide-Ende: ${boundary[2]}`);
      if (active === id) {
        if (!chunk.join("\n").trim()) throw new Error(`Leerer Guide-Abschnitt: ${id}`);
        chunks.push(chunk.join("\n").trim());
      }
      active = undefined;
      chunk = [];
    } else {
      if (active) throw new Error(`Verschachtelte Guide-Abschnitte: ${active}, ${boundary[2]}`);
      if (!guideChapters.some((chapter) => chapter.id === boundary[2])) throw new Error(`Unbekanntes Guide-Kapitel: ${boundary[2]}`);
      active = boundary[2];
    }
  }
  if (active) throw new Error(`Offener Guide-Abschnitt: ${active}`);
  if (!chunks.length) throw new Error(`Guide-Abschnitt fehlt: ${id}`);
  const excerpt = chunks.join("\n\n") + "\n";
  assertPublicOutput(excerpt);
  return excerpt;
}

export function renderGuideMarkdown(markdown: string, source: string) {
  const headings: { id: string; title: string }[] = [];
  const slugs = new Map<string, number>();
  const parser = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }) {
        if (depth < 2) throw new Error(`Guide-Inhalt beginnt mit Überschrift Ebene 2: ${source}`);
        const slug = text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-");
        const count = slugs.get(slug) ?? 0;
        slugs.set(slug, count + 1);
        const id = count ? `${slug}-${count}` : slug;
        if (depth === 2) headings.push({ id, title: text.replace(/[`*_]/g, "") });
        return `<h${depth} id="${escape(id)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      html() { throw new Error(`HTML im Guide bitte als Markdown ausdrücken: ${source}`); },
    },
    walkTokens(token) {
      if (token.type !== "link" && token.type !== "image") return;
      token.href = guideLink(token.href, source);
    },
  });
  return { html: parser.parse(markdown, { async: false }), headings };
}

export async function buildHomepageGuide(repoRoot: string) {
  const chapters = await Promise.all(guideChapters.map(async (chapter) => {
    const excerpt = guideExcerpt(await readFile(path.join(repoRoot, chapter.source), "utf8"), chapter.id);
    const rendered = renderGuideMarkdown(excerpt, chapter.source);
    const markdown = `# ${chapter.title}\n\n${chapter.description}\n\n${guideMarkdownLinks(excerpt, chapter.source)}`;
    return { ...chapter, ...rendered, markdown };
  }));
  return { chapters };
}

export type HomepageGuide = Awaited<ReturnType<typeof buildHomepageGuide>>;

const navigationGroups = [
  { title: "Verstehen", chapters: ["ideas", "runtime"], links: [] },
  { title: "Ausprobieren", chapters: ["getting-started"], links: [{ href: "reference.html#samples", title: "Startbare Samples" }] },
  { title: "Selbst bauen", chapters: ["functions", "programs", "extensions"], links: [] },
  { title: "Nachschlagen", chapters: ["access"], links: [{ href: "reference.html#tools", title: "Funktionen" }, { href: "reference.html#ui", title: "UI-Bausteine" }, { href: "developer.html", title: "Erweiterungsverträge" }] },
];

const chapterNavigation = (current?: string) => `<nav class="guide-chapters" aria-label="Guide-Navigation"><a href="guide.html"${current ? "" : ' aria-current="page"'}>Orientierung</a>${navigationGroups.map(group => `<div class="guide-nav-group"><p>${group.title}</p>${group.chapters.map(id => {
  const chapter = guideChapters.find(entry => entry.id === id)!;
  return `<a href="guide-${chapter.id}.html"${current === chapter.id ? ' aria-current="page"' : ""}>${escape(chapter.title)}</a>`;
}).join("")}${group.links.map(link => `<a href="${link.href}">${link.title}</a>`).join("")}</div>`).join("")}</nav>`;

const guideNavigation = (title: string, current?: string) => `<aside class="guide-sidebar">${chapterNavigation(current)}</aside><details class="guide-mobile-nav"><summary>Guide: ${escape(title)}</summary>${chapterNavigation(current)}</details>`;

export function guideIndexHtml(): string {
  return `<div class="guide-layout">${guideNavigation("Orientierung")}<article class="guide-body"><header class="guide-title"><p class="eyebrow">Guide</p><h1>Wo möchtest Du einsteigen?</h1><p>Grundideen verstehen, ein Sample ausprobieren oder selbst etwas bauen.</p></header><ol class="guide-index"><li><h2><a href="guide-ideas.html">Die Grundideen</a></h2><p>Wie Modelle, TypeScript, Actors und Mini-Apps zusammenarbeiten.</p></li><li><h2><a href="guide-getting-started.html">Ein Sample starten</a></h2><p>Eine vorbereitete Arbeitsumgebung öffnen und ihren Ablauf verfolgen.</p></li><li><h2><a href="guide-functions.html">Mit TypeScript bauen</a></h2><p>Funktionen verbinden, Abläufe steuern und eigene Oberflächen ergänzen.</p></li><li><h2><a href="reference.html">In der Referenz nachschlagen</a></h2><p>Genaue Funktionen und UI-Bausteine; <a href="developer.html">Verträge für Erweiterungen</a>.</p></li></ol><p><a href="guide.md">Guide als Markdown</a> / <a href="llms.txt">Textreferenzen für Coding-Agenten</a></p></article></div>`;
}

export function guideChapterHtml(chapter: HomepageGuide["chapters"][number]): string {
  const index = guideChapters.findIndex((entry) => entry.id === chapter.id);
  const previous = guideChapters[index - 1];
  const next = guideChapters[index + 1];
  return `<div class="guide-layout">${guideNavigation(chapter.title, chapter.id)}<article class="guide-body"><header class="guide-title"><p class="eyebrow"><a href="guide.html">Guide</a></p><h1>${escape(chapter.title)}</h1><p>${escape(chapter.description)}</p></header><details class="guide-page-nav"><summary>Auf dieser Seite</summary><nav aria-label="Auf dieser Seite">${chapter.headings.map(({ id, title }) => `<a href="#${escape(id)}">${escape(title)}</a>`).join("")}</nav></details>${chapter.html}<p class="guide-source">Quelle: <a href="../../${chapter.source}">${chapter.source}</a>. <a href="guide-${chapter.id}.md">Dieses Kapitel als Markdown</a>.</p><p><a href="${chapter.next}">${chapter.nextLabel}</a></p><nav class="guide-next" aria-label="Weiterlesen">${previous ? `<a href="guide-${previous.id}.html">Zurück: ${escape(previous.title)}</a>` : '<a href="guide.html">Zur Orientierung</a>'}${next ? `<a href="guide-${next.id}.html">Weiter: ${escape(next.title)}</a>` : '<a href="developer.html">Weiter zu den Erweiterungsverträgen</a>'}</nav></article></div>`;
}

export function guideMarkdownOutputs(guide: HomepageGuide): Record<string, string> {
  return {
    "guide.md": `# RAgents verstehen und erweitern\n\nEinstieg, Arbeitsweise und Entwicklung auf Basis der aktuellen Spec und Betriebsdokumentation.\n\n${guide.chapters.map((chapter) => `- [${chapter.title}](guide-${chapter.id}.md): ${chapter.description}`).join("\n")}\n\n[Bausteinreferenz](reference.md) / [Entwicklerreferenz](developer.md)\n`,
    ...Object.fromEntries(guide.chapters.map((chapter) => [`guide-${chapter.id}.md`, chapter.markdown])),
  };
}

export const guideCss = `<style>
.guide-layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:44px;align-items:start;padding-block:12px 32px}.guide-sidebar{position:sticky;top:calc(var(--header-height,80px) + 16px);max-height:calc(100dvh - var(--header-height,80px) - 32px);overflow:auto}.guide-chapters{display:grid;gap:16px;font-size:13px;line-height:1.4}.guide-chapters a{display:block;padding:6px 10px;text-decoration:none;border-radius:6px}.guide-nav-group{display:grid;gap:2px}.guide-nav-group>p{margin:0 10px 4px;font-size:11px;font-weight:700;color:#536b80}.guide-chapters [aria-current]{background:var(--card);color:var(--foreground);font-weight:600}.guide-mobile-nav{display:none}.guide-body{padding:0;border:0}.guide-title{margin:0 0 20px}.guide-title h1{font-size:32px;line-height:1.2;letter-spacing:-.025em;margin:6px 0 10px}.guide-title p{margin:0;font-size:15px}.guide-title .eyebrow{font-size:11px}.guide-body h2{font-size:24px;margin-top:32px;scroll-margin-top:20px}.guide-body h3{margin-top:24px}.guide-body pre{margin:20px 0}.guide-body li{margin-block:8px}.guide-body table{display:block;overflow:auto}.guide-body blockquote{margin-inline:0;padding:8px 20px;border-left:3px solid var(--primary);background:var(--card)}.guide-source{margin-top:40px;font-size:13px;color:#536b80}.guide-next{justify-content:space-between;border-top:1px solid var(--border);padding:20px 0;margin-top:24px}.guide-index{max-width:80ch;padding-left:24px}.guide-index li{padding:8px 0 16px 8px;border-bottom:1px solid var(--border)}.guide-index h2{font-size:20px;margin:0 0 6px}.guide-index p{margin-block:0}.guide-page-nav{margin:0 0 24px;font-size:13px}.guide-page-nav summary{padding:8px 12px}.guide-page-nav nav{display:grid;gap:8px;padding:4px 12px 12px}@media(max-width:850px){.guide-layout{grid-template-columns:1fr;gap:18px;padding-top:0}.guide-sidebar{display:none}.guide-mobile-nav{display:block;margin:0}.guide-mobile-nav summary{padding:10px 12px;font-size:14px}.guide-mobile-nav .guide-chapters{padding:0 12px 12px}.guide-title h1{font-size:28px}.guide-body h2{margin-top:28px}}@media print{.guide-layout{display:block}.guide-sidebar,.guide-mobile-nav,.guide-next{display:none}}
</style>`;
