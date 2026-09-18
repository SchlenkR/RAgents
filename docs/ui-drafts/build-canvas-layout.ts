// Rendert zwei Beispielszenen der Fläche mit der echten Layout-Engine und dem echten CSS als
// statische Seiten; Screenshots davon macht headless Chrome (siehe canvas-layout.html).
// Aufruf aus apps/web (dort liegt tsx): node --import tsx ../../docs/ui-drafts/build-canvas-layout.ts
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canvasLayoutOf, type CanvasLayout, type CanvasShape } from "../../plugins/ragents.orchestration/contract.ts";
import { layoutScene, lineGeometry, type PlacedBox } from "../../plugins/ragents.orchestration/web/canvas-layout.ts";
import { boundaryOf, buildScene, type Scene } from "../../plugins/ragents.orchestration/web/canvas-scene.ts";
import type { RunActor, RunView } from "../../plugins/ragents.orchestration/web/run-view.ts";

const here = dirname(fileURLToPath(import.meta.url));
const CHAT = { x: 0, y: 0, width: 820, height: 1020 };
const CHAT_LINK_LENGTH = 90;
const SHOT = { width: 1600, height: 1000, padding: 40 };

type State = "running" | "waiting" | "done" | "failed" | "stopped";
type Role = "primary" | "agent" | "script";

interface Cast {
  actors: RunActor[];
  states: Record<string, State>;
  inputs: Record<string, number>;
}

const actor = (id: string, handle: string, createdBy: string | undefined, kind: RunActor["kind"] = "agent", minute = 0): RunActor => ({
  id,
  kind,
  handle,
  displayName: handle,
  grants: [],
  createdAt: `2026-09-05T10:${String(minute).padStart(2, "0")}:00Z`,
  ...(createdBy ? { createdBy } : {}),
});

const viewOf = (cast: Cast): RunView => ({
  id: "run-demo",
  revision: 1,
  title: "Demo",
  ownerId: "human",
  primaryActorId: "koordinator",
  createdAt: "2026-09-05T10:00:00Z",
  forkedFrom: null,
  actors: [actor("human", "ronald", undefined, "human"), ...cast.actors],
  inputs: [],
  turns: [],
  subscriptions: [],
  pluginStates: [],
  actions: [],
  artifacts: [],
});

const cardSize = (handle: string) => ({
  width: Math.min(320, Math.max(150, 66 + (handle.length + 1) * 8.5)),
  height: 44,
});

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c] ?? c);

const roleIcon = (role: Role) => {
  if (role === "primary") return `<svg aria-hidden viewBox="0 0 16 16"><path d="M 8 1.6 L 9.6 6.4 L 14.4 8 L 9.6 9.6 L 8 14.4 L 6.4 9.6 L 1.6 8 L 6.4 6.4 Z" /></svg>`;
  if (role === "script") return `<svg aria-hidden viewBox="0 0 16 16"><rect x="1.5" y="2" width="6" height="4.5" rx="1.2" /><rect x="8.5" y="9.5" width="6" height="4.5" rx="1.2" /><path d="M4.5 6.5v5.2h4" /></svg>`;
  return `<svg aria-hidden viewBox="0 0 16 16"><path d="M 2.5 3.5 h 11 v 7 h -6 l -3 3 v -3 h -2 z" /></svg>`;
};

const shapeOutline = (shape: CanvasShape, box: PlacedBox) => {
  const inset = 1.5;
  const { width, height } = box;
  const figure = shape.kind === "circle"
    ? `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 2 - inset}" />`
    : `<polygon points="${width / 2},${inset} ${width - inset},${height / 2} ${width / 2},${height - inset} ${inset},${height / 2}" />`;
  return `<svg aria-hidden height="100%" viewBox="0 0 ${width} ${height}" width="100%">${figure}</svg>`;
};

const px = (value: number) => `${Math.round(value * 10) / 10}px`;

const renderScene = (cast: Cast, layout: CanvasLayout | undefined): { html: string; width: number; height: number } => {
  const view = viewOf(cast);
  const scene: Scene = buildScene({
    view,
    layout,
    actorSize: (entry) => cardSize(entry.handle),
    apps: [],
  });
  const originX = CHAT.x + CHAT.width + CHAT_LINK_LENGTH;
  const placed = layoutScene(scene.root, originX, CHAT.y);
  const boxes = new Map(placed.boxes.map((box) => [box.key, box]));
  const parts: string[] = [];

  const lines = scene.lines.map((line) => {
    const from = boxes.get(line.fromKey);
    const to = boxes.get(line.toKey);
    const fromInfo = scene.leaves.get(line.fromKey);
    const toInfo = scene.leaves.get(line.toKey);
    if (!from || !to || !fromInfo || !toInfo) return "";
    const g = lineGeometry({ box: from, boundary: boundaryOf(fromInfo) }, { box: to, boundary: boundaryOf(toInfo) });
    const markerEnd = line.arrow === "none" ? "" : ` marker-end="url(#net-arrow)"`;
    const markerStart = line.arrow === "both" ? ` marker-start="url(#net-arrow)"` : "";
    const label = line.label ? `<text class="net-line-label" text-anchor="middle" x="${g.middle.x}" y="${g.middle.y}">${escapeHtml(line.label)}</text>` : "";
    return `<g class="net-line net-line--${line.style}"><path d="M ${g.x1.toFixed(1)} ${g.y1.toFixed(1)} L ${g.x2.toFixed(1)} ${g.y2.toFixed(1)}"${markerEnd}${markerStart} />${label}</g>`;
  }).join("");
  parts.push(`<svg class="net-svg" height="4" width="4"><defs><marker id="net-arrow" markerHeight="9" markerWidth="9" orient="auto-start-reverse" refX="9" refY="5" viewBox="0 0 10 10"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>${lines}</svg>`);

  for (const frame of placed.frames) {
    const label = frame.label ? `<span class="net-group-label">${escapeHtml(frame.label)}</span>` : "";
    parts.push(`<div class="net-group${frame.outline ? " net-group--outline" : ""}" style="left:${px(frame.x)};top:${px(frame.y)};width:${px(frame.width)};height:${px(frame.height)}">${label}</div>`);
  }

  for (const box of placed.boxes) {
    const info = scene.leaves.get(box.key);
    if (!info) continue;
    const style = `left:${px(box.x)};top:${px(box.y)};width:${px(box.width)};height:${px(box.height)}`;
    if (info.type === "actor") {
      const entry = info.actor;
      const state = cast.states[entry.id] ?? "waiting";
      const role: Role = entry.kind === "script" ? "script" : entry.id === view.primaryActorId ? "primary" : "agent";
      const count = cast.inputs[entry.id] ?? 0;
      parts.push(`<div class="net-card${state === "running" ? " net-card--running" : ""}" style="${style}">`
        + `<button class="net-card-head" type="button"><span class="net-status" data-state="${state}">${roleIcon(role)}</span>`
        + `<span class="net-handle">@${escapeHtml(entry.handle)}</span><span class="net-input-count">${count}</span></button>`
        + `<div class="net-card-slots"></div></div>`);
    } else if (info.type === "shape") {
      parts.push(`<div class="net-shape net-shape--${info.shape.kind}" style="${style}">${shapeOutline(info.shape, box)}<span>${escapeHtml(info.shape.text)}</span></div>`);
    } else if (info.type === "missing") {
      parts.push(`<div class="net-missing" style="${style}">${escapeHtml(info.reference)}</div>`);
    }
  }

  const width = Math.max(CHAT.x + CHAT.width, originX + placed.width);
  const height = Math.max(CHAT.y + CHAT.height, CHAT.y + placed.height);
  return { html: parts.join("\n"), width, height };
};

const chatMock = (request: string, answer: string) => `<div class="stage-chat-mock" style="left:${CHAT.x}px;top:${CHAT.y}px;width:${CHAT.width}px;height:${CHAT.height}px">
  <div class="mock-bar"><span>Chat</span><span class="mock-pill">Lauf stoppen</span></div>
  <div class="mock-body">
    <div class="mock-bubble mock-bubble--user">${escapeHtml(request)}</div>
    <div class="mock-bubble">${escapeHtml(answer)}</div>
    <div class="mock-bubble mock-bubble--thin"></div>
    <div class="mock-bubble mock-bubble--thin mock-bubble--user"></div>
  </div>
  <div class="mock-composer">Nachricht an den Koordinator</div>
</div>`;

interface SceneSpec {
  file: string;
  title: string;
  caption: string;
  chat: [string, string];
  cast: Cast;
  layout: CanvasLayout;
}

const page = (spec: SceneSpec, scene: { html: string; width: number; height: number }) => {
  const { title, caption } = spec;
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="../../apps/web/src/tokens.css">
<link rel="stylesheet" href="../../plugins/ragents.orchestration/web/plugin.css">
<style>
  html, body { margin: 0; background: var(--qsl-app-bg); color: var(--qsl-text); font: 14px/1.4 var(--qsl-font); }
  .frame { max-width: 1600px; margin: 0 auto; padding: 28px ${SHOT.padding}px 48px; }
  .caption { margin: 0 0 18px; font-size: 13px; color: var(--qsl-muted); }
  .caption strong { color: var(--qsl-ink); font-size: 15px; margin-right: 10px; }
  .stage-wrap { position: relative; width: 100%; overflow: hidden; border: 1px solid var(--qsl-line); border-radius: 14px; background: var(--qsl-app-bg); padding: 24px; box-sizing: border-box; }
  .stage-world { position: relative; width: ${scene.width}px; height: ${scene.height}px; transform-origin: 0 0; }
  .stage-chat-mock { position: absolute; display: flex; flex-direction: column; border: 2px solid var(--qsl-ink); border-radius: 14px; background: var(--qsl-content); box-shadow: 3px 4px 0 color-mix(in srgb, var(--qsl-ink) 12%, transparent); overflow: hidden; }
  .mock-bar { display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-bottom: 1px solid var(--qsl-line-soft); font-weight: 700; color: var(--qsl-ink); }
  .mock-pill { padding: 4px 10px; border: 1.5px solid var(--qsl-ink); border-radius: 999px; font-size: 12px; font-weight: 600; }
  .mock-body { flex: 1; display: flex; flex-direction: column; gap: 14px; padding: 22px; }
  .mock-bubble { max-width: 70%; padding: 12px 16px; border-radius: 14px; background: var(--qsl-surface); color: var(--qsl-ink); font-size: 15px; line-height: 1.45; }
  .mock-bubble--user { align-self: flex-end; background: color-mix(in srgb, var(--qsl-accent) 14%, var(--qsl-content)); }
  .mock-bubble--thin { height: 18px; width: 55%; padding: 0; }
  .mock-composer { margin: 18px 22px 22px; padding: 14px 16px; border: 1.5px solid var(--qsl-line); border-radius: 12px; color: var(--qsl-muted); }
  .net-card-head { pointer-events: none; }
</style>
</head>
<body>
<div class="frame">
<p class="caption"><strong>${escapeHtml(title)}</strong>${escapeHtml(caption)}</p>
<div class="stage-wrap">
<div class="stage-world">
${chatMock(spec.chat[0], spec.chat[1])}
${scene.html}
</div>
</div>
</div>
<script>
(() => {
  const wrap = document.querySelector(".stage-wrap");
  const world = document.querySelector(".stage-world");
  const width = ${Math.round(scene.width)};
  const height = ${Math.round(scene.height)};
  const fit = () => {
    const scale = Math.min(1, (wrap.clientWidth - 48) / width);
    world.style.transform = "scale(" + scale + ")";
    wrap.style.height = Math.round(height * scale + 48) + "px";
  };
  fit();
  window.addEventListener("resize", fit);
})();
</script>
</body>
</html>
`;
};

const roundCast: Cast = {
  actors: [
    actor("koordinator", "koordinator", undefined, "agent", 0),
    actor("mira", "mira", "koordinator", "agent", 1),
    actor("jon", "jon", "koordinator", "agent", 2),
    actor("ada", "ada", "koordinator", "agent", 3),
  ],
  states: { koordinator: "waiting", mira: "done", jon: "running", ada: "waiting" },
  inputs: { koordinator: 3, mira: 2, jon: 2, ada: 1 },
};
const roundLayout = canvasLayoutOf({
  nodes: [
    { entity: "shape:thema" },
    { id: "runde", group: "circle", label: "Runde", frame: true },
    { entity: "@mira", parent: "runde" },
    { entity: "@jon", parent: "runde" },
    { entity: "@ada", parent: "runde" },
  ],
  shapes: [{ id: "thema", kind: "diamond", text: "Thema: Vier-Tage-Woche", size: 220 }],
  lines: [
    { from: "@mira", to: "@jon", arrow: "end", label: "gibt weiter" },
    { from: "@jon", to: "@ada", arrow: "end", label: "gibt weiter" },
    { from: "@ada", to: "@mira", arrow: "end", label: "gibt weiter" },
    { from: "shape:thema", to: "@mira", style: "dashed", label: "Auftakt" },
  ],
});

const teamCast: Cast = {
  actors: [
    actor("koordinator", "koordinator", undefined, "agent", 0),
    actor("teamleiter", "teamleiter", "koordinator", "agent", 1),
    actor("helfer1", "helfer1", "teamleiter", "agent", 2),
    actor("helfer2", "helfer2", "teamleiter", "agent", 3),
    actor("helfer3", "helfer3", "teamleiter", "agent", 4),
    actor("beobachter", "beobachter", "koordinator", "agent", 5),
    actor("sammler", "sammler", "teamleiter", "script", 6),
  ],
  states: { koordinator: "waiting", teamleiter: "running", helfer1: "done", helfer2: "running", helfer3: "done", beobachter: "waiting", sammler: "done" },
  inputs: { koordinator: 2, teamleiter: 4, helfer1: 1, helfer2: 1, helfer3: 1, beobachter: 0, sammler: 3 },
};
const teamLayout = canvasLayoutOf({
  nodes: [
    { id: "seite", group: "h", gap: 70 },
    { id: "team", group: "tree", root: "@teamleiter", label: "Team", frame: true, parent: "seite" },
    { id: "themen", group: "grid", columns: 2, label: "Themen", parent: "seite" },
    { entity: "shape:thema1", parent: "themen" },
    { entity: "shape:thema2", parent: "themen" },
    { entity: "shape:thema3", parent: "themen" },
    { entity: "shape:thema4", parent: "themen" },
  ],
  shapes: [
    { id: "thema1", kind: "circle", text: "Onboarding", size: 130 },
    { id: "thema2", kind: "circle", text: "Datenqualität", size: 130 },
    { id: "thema3", kind: "circle", text: "Berichte", size: 130 },
    { id: "thema4", kind: "circle", text: "Schulung", size: 130 },
  ],
  lines: [
    { from: "@helfer1", to: "shape:thema1", style: "dashed" },
    { from: "@helfer2", to: "shape:thema2", style: "dashed" },
    { from: "@helfer3", to: "shape:thema3", style: "dashed" },
  ],
});

const scenes: SceneSpec[] = [
  {
    file: "canvas-layout-gespraechsrunde.html",
    title: "Gesprächsrunde auf der Fläche",
    caption: "Kreisgruppe mit Rahmen, Thema als Raute, Pfeile in Gesprächsrichtung; der Koordinator bleibt unplatziert.",
    chat: [
      "Richte drei Gesprächspartner ein und zeig mir den Aufbau auf der Fläche, bevor es losgeht.",
      "Die Runde steht, das Layout ist gesetzt. Mira eröffnet mit dem Thema, dann geht es reihum.",
    ],
    cast: roundCast,
    layout: roundLayout,
  },
  {
    file: "canvas-layout-team-raster.html",
    title: "Team als Baum, Themen im Raster",
    caption: "Baum aus der Abstammung mit Rahmen, Raster ohne Rahmen, gestrichelte Zuordnungen; Koordinator und Beobachter unter \"Nicht platziert\".",
    chat: [
      "Ein Teamleiter mit drei Helfern als Baum, daneben die Themen als Kreise im Raster. Den Beobachter ordne nicht ein.",
      "Der Teamleiter hat drei Helfer und einen Sammler aufgestellt; das Raster zeigt die vier Themen, drei sind besetzt.",
    ],
    cast: teamCast,
    layout: teamLayout,
  },
];

for (const scene of scenes) {
  const rendered = renderScene(scene.cast, scene.layout);
  writeFileSync(join(here, scene.file), page(scene, rendered));
  console.log(`${scene.file}: ${Math.round(rendered.width)} x ${Math.round(rendered.height)} Weltpixel`);
}
