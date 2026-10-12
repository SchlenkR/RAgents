import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium, type Frame } from "playwright-core";
import { frameContentSecurityPolicy, frameHtml } from "../../../plugins/ragents.actor-programs/server/routes";
import { FRAME_BODY_CLASS, FRAME_DOCUMENT_CLASS, FRAME_ROOT_CLASS } from "../src/actor-programs/client-ui/frame-layout";
import { createClientProject } from "../../server/tests/client-project-fixture";
import { buildTailwind } from "../../server/src/plugin-support/actor-programs/tailwind";
import { tailwindPlugin } from "./tailwind-plugin";

const imports = `
import { createRoot } from "react-dom/client";
import { useAppState } from "@ragents/client";
import { AppLayout, Badge, Card, CardContent, CardHeader, CardTitle, DataTable, FilePicker, Form, Grid, Stack, TaskProgress } from "@ragents/client/ui";
type LatestRun = { title?: string; status?: string; lastActivity?: string; checkedAt?: string; error?: string };
`;
const mount = `
const root = document.getElementById("root");
if (!root) throw new Error("The #root element is missing.");
createRoot(root).render(<App />);
`;
const plain = `${imports}
function App() {
  const state = useAppState() as LatestRun | undefined;
  if (state?.error) return <main><h2>Latest run</h2><p>{state.error}</p></main>;
  if (!state?.title) return <main><h2>Latest run</h2><p>Loading...</p></main>;
  return <main>
    <h2>Latest run</h2>
    <p><strong>{state.title}</strong></p>
    <p><Badge variant="outline">{state.status}</Badge></p>
    <p>Last activity: {state.lastActivity ? new Date(state.lastActivity).toLocaleString() : "unknown"}</p>
    <p>Checked: {state.checkedAt ? new Date(state.checkedAt).toLocaleTimeString() : "unknown"}</p>
  </main>;
}
${mount}`;
const compact = `${imports}
function App() {
  const state = useAppState() as LatestRun | undefined;
  return <AppLayout><Stack>
    <Stack direction="row"><strong>{state?.title}</strong><Badge variant="outline">{state?.status}</Badge></Stack>
    <p className="type-meta text-muted-foreground">Last activity: {state?.lastActivity && new Date(state.lastActivity).toLocaleString()} | Checked: {state?.checkedAt && new Date(state.checkedAt).toLocaleTimeString()}</p>
  </Stack></AppLayout>;
}
${mount}`;
const probe = `${imports}
function App() {
  return <>
    <main aria-label="Semantic defaults">
      <h1>First heading</h1><p>Body text</p><h2>Second heading</h2><p>Next paragraph</p>
      <ul><li>First item</li><li>Second item</li></ul>
      <ol><li>Numbered item</li></ol>
      <table><tbody><tr><th>Key</th><td>Value</td></tr></tbody></table>
      <section aria-label="Inner section"><h3>Third heading</h3><p>Section text</p></section>
      <p className="mt-0">Zero margin</p><h2 className="text-xs font-normal mt-0">Small heading</h2>
      <ul className="list-none p-0"><li>No marker</li></ul>
    </main>
    <section aria-label="Library defaults">
      <AppLayout title="Layout title"><p>First block</p><p>Second block</p></AppLayout>
      <Stack><h2>Stack heading</h2><p>Stack body</p></Stack>
      <Grid><h2>Grid heading</h2><p>Grid body</p></Grid>
      <Card><CardHeader><CardTitle>Card title</CardTitle></CardHeader><CardContent>Card body</CardContent></Card>
      <Card size="sm"><CardContent>Small card</CardContent></Card>
      <Badge>Default badge</Badge>
      <div className="h-40"><AppLayout fill title="Bounded layout" actions={<Badge>Fixed actions</Badge>}>
        <div className="h-80">Tall content</div>
      </AppLayout></div>
    </section>
    <section aria-label="Structured controls">
      <TaskProgress tasks={[{id:"first",label:"First task",status:"pending"},{id:"second",label:"Second task",status:"done"}]} />
      <FilePicker label="Selected files" files={[new File(["one"], "one.txt"), new File(["two"], "two.txt")]} onChange={() => {}} showPreview={false} />
      <DataTable title="Records" rows={[]} columns={[{id:"name",label:"Name",value:(row: {name: string}) => row.name}]} rowKey={row => row.name} loading />
      <Form title="Read-only fields" readOnly fields={[{id:"choice",label:"Choice",type:"select",options:[{value:"ready",label:"Ready"}],hint:"Field hint"}]}
        values={{choice:"ready"}} onChange={() => {}} />
    </section>
  </>;
}
${mount}`;
const state = { title: "Review notes", status: "idle", lastActivity: "2026-10-12T10:08:00Z", checkedAt: "2026-10-12T10:10:00Z" };
const host = `
import { createRoot } from "react-dom/client";
import { ActorViewFrame } from "./plugins/ragents.actor-programs/web/ActorViewFrame";
import { initializeTheme } from "./apps/web/src/theme";
import { initializeAppearance } from "./apps/web/src/appearance";
import "./apps/web/src/ui/tailwind.css";
initializeTheme(window);
initializeAppearance(window);
const names = new URLSearchParams(location.search).has("probe") ? ["probe"] : ["plain", "compact"];
createRoot(document.getElementById("root")).render(<div className="grid grid-cols-2 gap-4 p-4">
  {names.map(name => <section key={name} aria-label={name} className="flex h-80 min-w-0 flex-col overflow-hidden rounded-panel border bg-card">
    <header className="type-item border-b px-4 py-2">Latest run</header>
    <ActorViewFrame runId="view-defaults" api={{ frameUrl: () => "/frame/" + name }} app={{
      id: name, actorId: "worker", actorHandle: "worker", title: "Latest run", revision: "installed",
      actions: [], state: { version: 1, revision: 1, values: ${JSON.stringify(state)} }, invocations: [],
    }} />
  </section>)}
</div>);
`;

const frameOf = async (page: import("playwright-core").Page, name: string) => {
  const element = await page.getByRole("region", { name, exact: true }).locator("iframe").elementHandle();
  assert.ok(element);
  const frame = await element.contentFrame();
  assert.ok(frame);
  await frame.getByText(state.title, { exact: true }).waitFor();
  return frame;
};
const lines = (frame: Frame) => frame.locator("#root").evaluate((root) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const rectangles: DOMRect[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    rectangles.push(...range.getClientRects());
  }
  const rows: { top: number; bottom: number }[] = [];
  for (const rect of rectangles.sort((a, b) => a.top - b.top)) {
    const last = rows.at(-1);
    if (last && rect.top < last.bottom - 1) last.bottom = Math.max(last.bottom, rect.bottom);
    else rows.push({ top: rect.top, bottom: rect.bottom });
  }
  return { count: rows.length, height: rows.at(-1)!.bottom - rows[0]!.top };
});

test("semantic views have frame defaults and library rows keep related facts compact", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-view-defaults-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const nonce = "view-defaults";
  const html = new Map<string, string>();
  const sample = process.env.RAGENTS_VIEW_SAMPLE;
  for (const [name, source] of [["plain", sample ? await readFile(sample, "utf8") : plain], ["compact", compact], ["probe", probe]]) {
    const project = await createClientProject({ stateSchema: { type: "object", properties: Object.fromEntries(Object.keys(state).map(key => [key, { type: "string" }])), additionalProperties: false }, actions: [] }, { "src/client.tsx": source! });
    try {
      const client = await project.compile();
      assert.equal(client.valid, true, JSON.stringify(client.diagnostics));
      const styles = await buildTailwind([project.directory]);
      html.set(`/frame/${name}`, frameHtml({
        html: `<!doctype html><html class="${FRAME_DOCUMENT_CLASS}"><head><meta charset="utf-8"></head><body class="${FRAME_BODY_CLASS}"><div id="root" class="${FRAME_ROOT_CLASS}"></div></body></html>`,
        styles, clientJavaScript: client.javaScript, platformVersion: 2,
      } as Parameters<typeof frameHtml>[0], nonce));
    } finally { await project.remove(); }
  }
  await build({ stdin: { contents: host, resolveDir: root, sourcefile: "fixture.tsx", loader: "tsx" },
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "host.js"),
    plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}plugins/ragents.actor-programs/web`, fileURLToPath(new URL("./", import.meta.url))])], logLevel: "silent" });
  const script = await readFile(join(directory, "host.js"));
  const styles = await readFile(join(directory, "host.css"));
  const server = createServer((request, response) => {
    const path = request.url!.split("?")[0]!;
    const frame = html.get(path);
    if (frame) { response.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": frameContentSecurityPolicy(nonce) }); response.end(frame); }
    else if (path === "/host.js") { response.setHeader("Content-Type", "text/javascript"); response.end(script); }
    else if (path === "/host.css") { response.setHeader("Content-Type", "text/css"); response.end(styles); }
    else if (path === "/") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html><head><link rel="icon" href="data:,"><link rel="stylesheet" href="/host.css"></head><body><div id="root"></div><script src="/host.js"></script></body></html>'); }
    else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const page = await browser.newPage({ locale: "en-GB", timezoneId: "UTC", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const theme = new URLSearchParams(location.search).get("theme");
    if (!theme) throw new Error("The fixture theme is missing.");
    localStorage.setItem("ragents.theme", theme);
  });
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const screenshots = join(tmpdir(), "ragents-browser-shots");
  await mkdir(screenshots, { recursive: true });
  for (const theme of ["light", "dark"]) for (const width of [1200, 720]) {
    await page.setViewportSize({ width, height: 460 });
    await page.goto(`${origin}/?theme=${theme}`);
    const plainFrame = await frameOf(page, "plain");
    const compactFrame = await frameOf(page, "compact");
    for (const frame of [plainFrame, compactFrame]) assert.equal(await frame.evaluate(() => document.documentElement.dataset.theme), theme);
    const blocks = await plainFrame.locator("main").evaluate(main => [...main.children].map(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, font: parseFloat(style.fontSize), margin: parseFloat(style.marginTop) };
    }));
    assert.ok(blocks[0]!.font > blocks[1]!.font, "the plain heading is larger than body text");
    for (let index = 1; index < blocks.length; index++) {
      assert.ok(blocks[index]!.margin > 0 && blocks[index]!.top > blocks[index - 1]!.bottom, "every plain block has visible spacing");
    }
    const plainLines = await lines(plainFrame);
    const compactLines = await lines(compactFrame);
    assert.ok(compactLines.count < plainLines.count && compactLines.height < plainLines.height, JSON.stringify({ width, theme, plainLines, compactLines }));
    const title = await compactFrame.getByText(state.title, { exact: true }).boundingBox();
    const badge = await compactFrame.getByText(state.status, { exact: true }).boundingBox();
    assert.ok(title && badge && title.y < badge.y + badge.height && badge.y < title.y + title.height, "title and status share one row");
    assert.ok(await compactFrame.locator("#root").evaluate(element => element.scrollWidth <= element.clientWidth), "the compact view fits a narrow widget");
    const shot = join(screenshots, `view-defaults-${theme}-${width}.png`);
    await page.screenshot({ path: shot });
    context.diagnostic(`${shot}: plain ${plainLines.count} lines, compact ${compactLines.count} lines`);
  }
  await page.goto(`${origin}/?theme=light&probe`);
  const probeElement = await page.getByRole("region", { name: "probe", exact: true }).locator("iframe").elementHandle();
  assert.ok(probeElement);
  const probeFrame = await probeElement.contentFrame();
  assert.ok(probeFrame);
  await probeFrame.getByText("Default badge", { exact: true }).waitFor();
  const semantic = await probeFrame.getByRole("main", { name: "Semantic defaults" }).evaluate(main => {
    const children = [...main.children];
    return {
      margins: children.slice(1, 8).map(element => parseFloat(getComputedStyle(element).marginTop)),
      ul: getComputedStyle(main.querySelector("ul")!).listStyleType,
      ol: getComputedStyle(main.querySelector("ol")!).listStyleType,
      cellPadding: parseFloat(getComputedStyle(main.querySelector("td")!).paddingTop),
      overrides: children.slice(-3).map(element => ({ margin: getComputedStyle(element).marginTop, font: getComputedStyle(element).fontSize, list: getComputedStyle(element).listStyleType, padding: getComputedStyle(element).paddingLeft })),
    };
  });
  assert.ok(semantic.margins.every(margin => margin > 0));
  assert.equal(semantic.ul, "disc");
  assert.equal(semantic.ol, "decimal");
  assert.ok(semantic.cellPadding > 0);
  assert.equal(semantic.overrides[0]!.margin, "0px");
  assert.equal(semantic.overrides[1]!.margin, "0px");
  assert.equal(semantic.overrides[1]!.font, "10.88px");
  assert.equal(semantic.overrides[2]!.list, "none");
  assert.equal(semantic.overrides[2]!.padding, "0px");
  const library = await probeFrame.getByRole("region", { name: "Library defaults" }).evaluate(section => {
    const layout = section.children[0]!;
    const content = layout.children[1]!;
    const stack = section.children[1]!;
    const grid = section.children[2]!.firstElementChild!;
    const cards = [...section.querySelectorAll('[data-slot="card"]')];
    return {
      unit: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--spacing")) * 16,
      layout: { gap: parseFloat(getComputedStyle(layout).gap), padding: parseFloat(getComputedStyle(layout).paddingTop) },
      contentGap: parseFloat(getComputedStyle(content).gap), stackGap: parseFloat(getComputedStyle(stack).gap), gridGap: parseFloat(getComputedStyle(grid).gap),
      margins: [content, stack, grid].flatMap(parent => [...parent.children].map(child => getComputedStyle(child).marginTop)),
      cards: cards.map(card => ({ padding: parseFloat(getComputedStyle(card).paddingTop), gap: parseFloat(getComputedStyle(card).gap), inset: parseFloat(getComputedStyle(card.lastElementChild!).paddingLeft) })),
      badge: section.querySelector('[data-slot="badge"]')!.getBoundingClientRect().height,
    };
  });
  const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.05, `${actual} should be ${expected}`);
  near(library.layout.gap, library.unit * 3);
  near(library.layout.padding, library.unit * 3);
  near(library.contentGap, library.unit * 3);
  near(library.stackGap, library.unit * 2);
  near(library.gridGap, library.unit * 3);
  assert.ok(library.margins.every(margin => margin === "0px"), "layout gaps replace semantic margins");
  for (const [index, card] of library.cards.entries()) {
    near(card.padding, library.unit * (index === 0 ? 4 : 3));
    near(card.gap, card.padding);
    near(card.inset, card.padding);
  }
  assert.ok(library.badge > 0 && library.badge < library.unit * 6, "Badge remains compact without props");
  const fill = await probeFrame.getByRole("region", { name: "Bounded layout" }).evaluate(layout => {
    const content = layout.children[1]!;
    const title = layout.firstElementChild!.getBoundingClientRect();
    const actions = layout.lastElementChild!.getBoundingClientRect();
    content.scrollTop = content.scrollHeight;
    return { scrollable: content.scrollHeight > content.clientHeight, scrolled: content.scrollTop > 0,
      margin: parseFloat(getComputedStyle(content).marginTop),
      fixed: title.top === layout.firstElementChild!.getBoundingClientRect().top && actions.top === layout.lastElementChild!.getBoundingClientRect().top };
  });
  assert.ok(fill.scrollable && fill.scrolled && fill.fixed && fill.margin < 0, "fill keeps content scrolling and fixed header/actions without removing its focus inset");
  const controls = probeFrame.getByRole("region", { name: "Structured controls" });
  const lists = await controls.getByRole("list").evaluateAll(elements => elements.map(element => ({
    style: getComputedStyle(element).listStyleType, padding: getComputedStyle(element).paddingLeft,
    margins: [...element.children].map(child => getComputedStyle(child).marginTop),
  })));
  assert.equal(lists.length, 2);
  assert.ok(lists.every(list => list.style === "none" && list.padding === "0px" && list.margins.every(margin => margin === "0px")), "structured control lists keep their marker-free rows");
  for (const paragraph of [controls.getByText("Loading...", { exact: true }), controls.getByText("Ready", { exact: true }), controls.getByText("Field hint", { exact: true }), controls.getByText("Select files, drag them here, or paste while the file picker is focused.", { exact: true })]) {
    assert.equal(await paragraph.evaluate(element => getComputedStyle(element).marginTop), "0px", "control gaps own paragraph spacing");
  }
  assert.deepEqual(errors, []);
});
