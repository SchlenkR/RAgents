// Baut aus drafts/<richtung>/drafts.json die Übersichtsseite index.html (Bilder relativ verlinkt).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const draftsDir = join(root, "drafts");
const directions = {
  roboter: { title: "Roboter-Maskottchen", text: "Ein freundlicher Roboter als Koordinator, der seine Helfer führt." },
  wortmarke: { title: "Wortmarke und Monogramm", text: "Typografische Logos rund um das R und den Schriftzug." },
  symbol: { title: "Abstraktes Symbol", text: "Orchestrierung als Form: ein Knoten, der viele führt." },
  tiere: { title: "Tier-Maskottchen", text: "Tiere, die Koordination und viele Helfer verkörpern." },
  "app-icon": { title: "App-Icon und Favicon", text: "Das Zeichen in der abgerundeten Kachel, auch bei 16 Pixeln lesbar." },
  "graffiti-wildstyle": { title: "Graffiti: Wildstyle", text: "RAgents als verschachteltes Chrom-Piece mit Totenkopf, wie auf dem Doppelstockzug." },
  "graffiti-skull-hard": { title: "Graffiti: Totenkopf, hart und kantig", text: "Der Wildstyle mit Schädel, aber eckiger, blockiger und bedrohlicher - auf abstraktem Grund statt auf dem Zug." },
  "graffiti-blockbuster": { title: "Graffiti: Blockbuster", text: "Massive schwarze 3D-Blockbuchstaben mit Chromwolke, wie auf der S-Bahn." },
  "graffiti-flat": { title: "Graffiti: flächig und blockig", text: "Keine Spitzen mehr - breite Slabs, große Flächen, der Schädel als Teil des Blocks." },
  "graffiti-ruhig": { title: "Graffiti: ruhig und souverän", text: "Dieselbe Masse, aber still gestellt: gerade Grundlinie, gedämpfte Farben, unterschwellig bedrohlich." },
  "graffiti-verschmolzen": { title: "Graffiti: verschmolzen und plastisch", text: "Schädel und R als eine Form, verschachtelte abstrakte Buchstaben, stumpf statt spitz, mit echtem Volumen." },
  "graffiti-biomech": { title: "Graffiti: biomechanisch", text: "Schädel und Schrift als ein gewachsener Organismus aus Knochen, Wirbeln und Schläuchen." },
  "graffiti-biomech-eckig": { title: "Graffiti: biomechanisch und kantig", text: "Wie die biomechanische Reihe, aber die Buchstaben aus kantigen Platten statt aus Röhren." },
  "psycho-character": { title: "Psycho-Charakter", text: "Das irre Grinsen: Dämonenkopf mit schiefen Zähnen, dicke Outlines, knallige Wand." },
  "character-piece": { title: "Charakter und Piece", text: "Maskottchen und RAgents-Schriftzug zusammen auf Zug oder Wand." },
};

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

const sections = readdirSync(draftsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const folder = join(draftsDir, entry.name);
    const file = join(folder, "drafts.json");
    const drafts = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
    const error = existsSync(join(folder, "error.md")) ? readFileSync(join(folder, "error.md"), "utf8") : "";
    const meta = directions[entry.name] ?? { title: entry.name, text: "" };
    return { slug: entry.name, ...meta, drafts: drafts.filter((d) => existsSync(join(folder, d.file))), error };
  })
  .sort((a, b) => Object.keys(directions).indexOf(a.slug) - Object.keys(directions).indexOf(b.slug));

const total = sections.reduce((sum, section) => sum + section.drafts.length, 0);

const card = (slug, draft, index) => `
<figure class="card" data-section="${slug}" data-index="${index}">
  <button class="shot" type="button" data-src="drafts/${slug}/${escapeHtml(draft.file)}" data-title="${escapeHtml(draft.title)}" data-prompt="${escapeHtml(draft.prompt ?? "")}">
    <img alt="${escapeHtml(draft.title)}" loading="lazy" src="drafts/${slug}/${escapeHtml(draft.file)}">
  </button>
  <figcaption>
    <strong>${escapeHtml(draft.title)}</strong>
    <p>${escapeHtml(draft.concept ?? "")}</p>
    <small>${escapeHtml(draft.model ?? "")} · ${escapeHtml(draft.file)}</small>
  </figcaption>
</figure>`;

const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RAgents Logo-Entwürfe</title>
<style>
  :root { --ink: #223347; --muted: #7692ad; --line: #d1dde9; --paper: #f4f6fa; --card: #fff; --accent: #2a94fa; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.55 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { padding: 30px 32px 18px; background: linear-gradient(135deg, #0d3b66, #2a94fa); color: #fff; }
  header h1 { margin: 0 0 4px; font-size: 26px; }
  header p { margin: 0; opacity: .85; }
  nav { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 32px; border-bottom: 1px solid var(--line); background: #fff; position: sticky; top: 0; z-index: 2; }
  nav a { padding: 6px 12px; border: 1px solid var(--line); border-radius: 999px; color: var(--ink); text-decoration: none; font-size: 13px; }
  nav a:hover { border-color: var(--accent); color: var(--accent); }
  main { padding: 10px 32px 60px; }
  section { margin: 28px 0; }
  section h2 { margin: 0 0 2px; font-size: 20px; }
  section > p { margin: 0 0 14px; color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; }
  .card { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; }
  .shot { display: block; width: 100%; padding: 0; border: 0; background: repeating-conic-gradient(#eef1f5 0 25%, #fff 0 50%) 0 0 / 20px 20px; cursor: zoom-in; }
  .shot img { display: block; width: 100%; height: auto; }
  .grid { align-items: start; }
  .grid--wide { grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); }
  figcaption { padding: 10px 12px 12px; }
  figcaption strong { display: block; font-size: 14px; }
  figcaption p { margin: 4px 0 6px; font-size: 13px; color: var(--ink); }
  figcaption small { color: var(--muted); font-size: 11px; word-break: break-all; }
  .empty { padding: 20px; border: 1px dashed var(--line); border-radius: 12px; color: var(--muted); white-space: pre-wrap; }
  .lightbox { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(13, 24, 40, .82); z-index: 10; padding: 30px; }
  .lightbox.open { display: flex; }
  .lightbox img { max-width: min(900px, 90vw); max-height: 70vh; background: #fff; border-radius: 12px; }
  .lightbox .info { max-width: min(900px, 90vw); margin-top: 12px; color: #fff; font-size: 13px; }
  .lightbox .info strong { display: block; font-size: 16px; margin-bottom: 4px; }
  .lightbox .info code { display: block; margin-top: 6px; padding: 8px 10px; background: rgba(255,255,255,.12); border-radius: 8px; white-space: pre-wrap; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>RAgents Logo-Entwürfe</h1>
  <p>${total} Entwürfe aus ${sections.length} Richtungen, erzeugt mit Higgsfield am ${new Date().toISOString().slice(0, 10)}. Klick auf ein Bild zeigt es groß mit dem Prompt.</p>
</header>
<nav>${sections.map((section) => `<a href="#${section.slug}">${escapeHtml(section.title)} (${section.drafts.length})</a>`).join("")}</nav>
<main>
${sections.map((section) => `
<section id="${section.slug}">
  <h2>${escapeHtml(section.title)}</h2>
  <p>${escapeHtml(section.text)}</p>
  ${section.drafts.length ? `<div class="${section.slug.startsWith("graffiti") || section.slug === "character-piece" ? "grid grid--wide" : "grid"}">${section.drafts.map((draft, index) => card(section.slug, draft, index)).join("")}</div>` : `<div class="empty">${escapeHtml(section.error || "Keine Entwürfe abgelegt.")}</div>`}
</section>`).join("")}
</main>
<div class="lightbox" id="lightbox">
  <div>
    <img alt="" id="lightbox-image">
    <div class="info"><strong id="lightbox-title"></strong><code id="lightbox-prompt"></code></div>
  </div>
</div>
<script>
  const box = document.getElementById('lightbox');
  document.querySelectorAll('.shot').forEach((button) => button.addEventListener('click', () => {
    document.getElementById('lightbox-image').src = button.dataset.src;
    document.getElementById('lightbox-title').textContent = button.dataset.title;
    document.getElementById('lightbox-prompt').textContent = button.dataset.prompt;
    box.classList.add('open');
  }));
  box.addEventListener('click', () => box.classList.remove('open'));
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') box.classList.remove('open'); });
</script>
</body>
</html>
`;
writeFileSync(join(root, "index.html"), html);
console.log(`index.html: ${total} Entwürfe in ${sections.length} Richtungen`);
