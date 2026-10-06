import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, type Locator, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./docking-fixture";

const shots = join(tmpdir(), "ragents-browser-shots");
const options = { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000 };

/** Builds the docking fixture and opens it with Chat, Notes and Board; the returned helpers act on the header and the dock. */
async function prepare(context: TestContext, search = "") {
  const directory = await mkdtemp(join(tmpdir(), "ragents-dock-windows-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("docking-fixture.tsx", import.meta.url))], bundle: true,
    platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    plugins: [tailwindPlugin([`${root}apps/web/src`])], logLevel: "silent" });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"></head><body><div id="root" style="height:700px;display:flex"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  await mkdir(shots, { recursive: true });
  const fixture = pathToFileURL(join(directory, "index.html")).href;
  const errors: string[] = [];
  const open = async (page: Page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(fixture + search);
    await page.getByRole("tab", { name: "Chat", exact: true }).waitFor();
    await page.evaluate(() => window.dockingFixture.setApps(["notes", "board"]));
    await page.getByRole("tab", { name: "Board", exact: true }).waitFor();
  };
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.setDefaultTimeout(8000);
  await open(page);
  const actions = page.getByRole("group", { name: "Layout actions" });
  const view = (name: string) => actions.getByRole("button", { name, exact: true });
  const drop = actions.locator("[data-dock-window-drop]");
  const box = async (locator: Locator) => { const rect = await locator.boundingBox(); assert.ok(rect); return rect; };
  const press = async (locator: Locator) => {
    const rect = await box(locator);
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
  };
  const moveTo = async (locator: Locator, fraction: number) => {
    const rect = await box(locator);
    await page.mouse.move(rect.x + rect.width * fraction, rect.y + rect.height / 2, { steps: 8 });
  };
  const finishDrop = async () => {
    await page.locator("[data-dock-preview]").waitFor();
    await page.mouse.up();
    await page.getByLabel("Docking guides", { exact: true }).waitFor({ state: "hidden" });
  };
  const dockOnto = async (source: Locator, area: Locator, guide: string) => {
    await press(source);
    const rect = await box(area);
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2 + 100, { steps: 8 });
    const target = await box(page.locator(`[data-dock-guide="${guide}"]`));
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 3 });
    await finishDrop();
  };
  return {
    browser, errors, open, page, actions, view, drop, box, press, moveTo, finishDrop, dockOnto,
    tab: (name: string) => page.getByRole("tab", { name, exact: true }),
    panel: (name: string) => page.getByRole("tabpanel", { name, exact: true }),
    groups: page.locator("[data-dock-group]"),
    savedLayout: () => page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([key]) => key.startsWith("ragents.docking:"))![1])),
  };
}

test("browser header window buttons show grips, reorder by drag and keyboard, dock onto guides, still open on click, and persist", options, async (context) => {
  const { browser, errors, open, page, actions, view, drop, box, press, moveTo, dockOnto: dockFrom, tab, panel, groups, savedLayout } = await prepare(context);
  const order = () => actions.locator("[data-dock-window]").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  const savedOrder = async () => (await savedLayout()).order;
  const gripOpacity = (name: string) => view(name).locator("[data-dock-window-grip]").evaluate((element) => getComputedStyle(element).opacity);
  const dragInHeader = async (source: string, target: string, fraction: number) => {
    await press(view(source));
    await moveTo(view(target), fraction);
    await drop.waitFor();
  };
  const dockOnto = (source: string, area: Locator, guide: string) => dockFrom(view(source), area, guide);

  await page.waitForFunction(() => document.querySelectorAll("[data-dock-group]").length === 2);
  assert.deepEqual(await order(), ["Chat", "Notes", "Board"]);
  assert.equal(await actions.locator("[data-dock-window-grip]").count(), 4, "every window button and Empty space have a grip, Reset layout has none");
  assert.equal(await gripOpacity("Notes"), "0", "grips stay subtle until hover or focus");
  await view("Notes").hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-dock-window="app:notes"] [data-dock-window-grip]')!).opacity === "1");
  await page.screenshot({ path: join(shots, "dock-windows-hover.png") });
  await page.mouse.move(600, 400);
  await view("Board").focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Board");
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-dock-window="app:board"] [data-dock-window-grip]')!).opacity === "1");
  assert.deepEqual(await order(), ["Chat", "Board", "Notes"], "Alt+ArrowLeft moves the focused button left");
  await page.keyboard.press("Alt+ArrowRight");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Board");
  assert.deepEqual(await order(), ["Chat", "Notes", "Board"], "Alt+ArrowRight moves it back and keeps the focus");
  await page.keyboard.press("Alt+ArrowRight");
  assert.deepEqual(await order(), ["Chat", "Notes", "Board"], "the last button stays last");
  assert.equal(await panel("Board").isVisible(), false, "reordering does not open a window");

  await dragInHeader("Board", "Chat", 0.25);
  assert.equal(await view("Chat").locator("[data-dock-window-drop]").count(), 1, "the drop marker sits before Chat");
  assert.equal(await view("Board").getAttribute("data-dragging"), "true");
  assert.equal(await page.getByLabel("Docking guides", { exact: true }).getByText("Board", { exact: true }).count(), 0, "no drag label over the header");
  await page.screenshot({ path: join(shots, "dock-windows-reorder.png") });
  await page.mouse.up();
  await drop.waitFor({ state: "hidden" });
  assert.deepEqual(await order(), ["Board", "Chat", "Notes"]);
  assert.deepEqual(await savedOrder(), ["app:board", "chat", "app:notes"]);
  assert.equal(await groups.count(), 2, "a header drop leaves the dock layout as it is");
  assert.equal(await panel("Board").isVisible(), false);

  await dragInHeader("Chat", "Reset layout", 0.5);
  assert.equal(await view("Notes").locator("[data-dock-window-drop]").count(), 1, "the drop marker sits after the last window");
  await page.mouse.up();
  assert.deepEqual(await order(), ["Board", "Notes", "Chat"]);

  const board = await box(view("Board"));
  await page.mouse.move(board.x + board.width / 2, board.y + board.height / 2);
  await page.mouse.down();
  await page.mouse.move(board.x + board.width / 2 + 12, board.y + board.height / 2, { steps: 4 });
  assert.equal(await drop.count(), 0, "no marker where the order would stay");
  await page.mouse.up();
  assert.deepEqual(await order(), ["Board", "Notes", "Chat"]);
  assert.equal(await panel("Board").isVisible(), false, "a drag is not a click");

  await dragInHeader("Chat", "Board", 0.25);
  await page.keyboard.press("Escape");
  await drop.waitFor({ state: "hidden" });
  await page.mouse.up();
  assert.deepEqual(await order(), ["Board", "Notes", "Chat"], "Escape cancels a header drag");

  await view("Board").click();
  assert.equal(await panel("Board").isVisible(), true, "a click still brings a background window to the front");
  await page.getByRole("button", { name: "Close Notes", exact: true }).click();
  assert.equal(await view("Notes").getAttribute("aria-pressed"), "false");
  const notes = await box(view("Notes"));
  await page.mouse.move(notes.x + notes.width / 2, notes.y + notes.height / 2);
  await page.mouse.down();
  await page.mouse.move(notes.x + notes.width / 2 + 3, notes.y + notes.height / 2 + 2, { steps: 2 });
  await page.mouse.up();
  await tab("Notes").waitFor();
  assert.equal(await view("Notes").getAttribute("aria-pressed"), "true", "a movement below the threshold still opens the window");

  const chatArea = groups.filter({ has: tab("Chat") });
  await page.getByRole("button", { name: "Close Board", exact: true }).click();
  const before = await groups.count();
  await dockOnto("Board", chatArea, "group-bottom");
  assert.equal(await groups.count(), before + 1, "dropping a closed window's button on a compass side splits that area");
  assert.equal(await groups.filter({ has: tab("Board") }).getByRole("tab").count(), 1);
  assert.ok((await box(groups.filter({ has: tab("Board") }))).y > (await box(chatArea)).y + 50, "the window lands below Chat");
  assert.equal(await panel("Board").isVisible(), true);
  await dockOnto("Notes", chatArea, "group-center");
  assert.equal(await chatArea.getByRole("tab", { name: "Notes", exact: true }).count(), 1, "the compass center moves an open window into the area as a tab");
  assert.equal(await groups.count(), before, "the emptied source area closes");
  assert.equal(await panel("Notes").isVisible(), true);
  await page.screenshot({ path: join(shots, "dock-windows-docked.png") });

  await page.reload();
  await tab("Chat").waitFor();
  await page.waitForFunction(() => document.querySelectorAll("[data-dock-window]").length === 2);
  assert.deepEqual(await order(), ["Notes", "Chat"], "the order survives reload");
  await page.evaluate(() => window.dockingFixture.setApps(["notes", "board"]));
  await tab("Board").waitFor();
  assert.deepEqual(await order(), ["Notes", "Chat", "Board"], "a new window joins at the end");

  await page.evaluate(() => { document.documentElement.style.zoom = "1.3"; });
  await page.waitForFunction(() => document.documentElement.style.zoom === "1.3");
  await dragInHeader("Board", "Notes", 0.25);
  await page.mouse.up();
  assert.deepEqual(await order(), ["Board", "Notes", "Chat"], "header reordering follows the pointer under page zoom");
  const zoomedBefore = await groups.count();
  await dockOnto("Board", groups.filter({ has: tab("Chat") }), "group-right");
  assert.equal(await groups.count(), zoomedBefore + 1, "docking from the header follows the pointer under page zoom");
  assert.equal(await groups.filter({ has: tab("Board") }).getByRole("tab").count(), 1);
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });

  await view("Reset layout").click();
  assert.deepEqual(await order(), ["Chat", "Notes", "Board"], "Reset layout restores the catalog order");
  assert.equal(await savedOrder(), undefined);

  await page.setViewportSize({ width: 200, height: 800 });
  for (const name of ["Chat", "Notes", "Board", "Empty space"]) {
    const button = await box(view(name));
    const grip = await box(view(name).locator("[data-dock-window-grip]"));
    const icon = await box(view(name).locator("svg").nth(1));
    assert.ok(grip.x >= button.x && grip.x + grip.width <= button.x + button.width, `the ${name} grip stays inside its narrow button`);
    assert.ok(icon.x >= grip.x + grip.width - 0.5, `the ${name} icon does not overlap its grip`);
  }

  const touch = await browser.newContext({ hasTouch: true, viewport: { width: 1200, height: 800 } });
  context.after(() => touch.close());
  const touchPage = await touch.newPage();
  await open(touchPage);
  const touchActions = touchPage.getByRole("group", { name: "Layout actions" });
  assert.deepEqual(await touchActions.locator("[data-dock-window-grip]").evaluateAll((grips) => grips.map((grip) => getComputedStyle(grip).opacity)), ["1", "1", "1", "1"], "touch screens always show the grips");
  await touchPage.screenshot({ path: join(shots, "dock-windows-touch.png") });
  await touchPage.getByRole("button", { name: "Close Board", exact: true }).tap();
  await touchActions.getByRole("button", { name: "Board", exact: true }).tap();
  await touchPage.getByRole("tab", { name: "Board", exact: true }).waitFor();
  assert.equal(await touchActions.getByRole("button", { name: "Board", exact: true }).getAttribute("aria-pressed"), "true", "a tap opens the window");
  assert.deepEqual(errors, []);
});

test("the flyout button moves a tool into the right workspace edge as a regular window by pointer and keyboard", options, async (context) => {
  const { errors, page, view, tab, panel, groups, box, dockOnto, savedLayout } = await prepare(context);
  const rail = page.getByRole("navigation", { name: "Sidebar tabs" });
  const files = rail.getByRole("button", { name: "Files", exact: true });
  const sidebar = page.locator("[data-dock-sidebar]");
  const move = page.getByRole("button", { name: "Move into layout", exact: true });
  const filesArea = groups.filter({ has: tab("Files") });
  const card = async (area: Locator) => page.locator(`[data-dock-card="${await area.getAttribute("data-dock-group")}"]`);

  await page.waitForFunction(() => document.querySelectorAll("[data-dock-group]").length === 2);
  const original = await savedLayout();
  const bounds = await page.locator("[data-dock-card]").evaluateAll((cards) => {
    const rectangles = cards.map((element) => element.getBoundingClientRect());
    const left = Math.min(...rectangles.map((rect) => rect.left));
    const top = Math.min(...rectangles.map((rect) => rect.top));
    return { left, top, right: Math.max(...rectangles.map((rect) => rect.right)), bottom: Math.max(...rectangles.map((rect) => rect.bottom)) };
  });
  const assertRightEdge = async () => {
    const rect = await box(await card(filesArea));
    const width = (bounds.right - bounds.left - 6) * 0.35;
    assert.ok(Math.abs(rect.width - width) < 1, "the tool gets the outer guide's 35 percent workspace allocation");
    assert.ok(Math.abs(rect.x + rect.width - bounds.right) < 1, "the window sits at the workspace's right edge");
    assert.ok(Math.abs(rect.y - bounds.top) < 1);
    assert.ok(Math.abs(rect.height - (bounds.bottom - bounds.top)) < 1, "the window spans the whole workspace height");
    assert.equal(await sidebar.count(), 0);
    assert.equal(await page.getByRole("separator", { name: "Resize sidebar", exact: true }).count(), 0);
    assert.equal(await files.count(), 1, "moving the panel leaves its button in the rail");
    assert.equal(await files.getAttribute("aria-pressed"), "true");
    assert.deepEqual((await savedLayout()).side, { tab: null, mode: "hidden", focused: false });
    return rect;
  };

  await files.click();
  await sidebar.waitFor();
  assert.equal(await sidebar.getAttribute("data-dock-sidebar"), "flyout");
  assert.deepEqual((await savedLayout()).root, original.root, "a rail click opens an overlay without inserting a window");
  assert.equal(await groups.count(), 2);
  assert.equal(await move.getAttribute("title"), "Move into layout");
  assert.equal(await move.getAttribute("aria-pressed"), null, "placing a window is an action");
  const draft = page.getByRole("textbox", { name: "Files draft", exact: true });
  await draft.fill("Kept tool draft");
  const input = await draft.elementHandle();
  await move.click();
  await tab("Files").waitFor();
  assert.equal(await groups.count(), 3);
  const placed = await assertRightEdge();
  assert.deepEqual(await filesArea.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
    ["Move area", "Return Files to sidebar", "Maximize area", "Close Files"]);
  assert.equal(await panel("Files").getAttribute("aria-labelledby"), await tab("Files").getAttribute("id"));
  assert.equal(await page.getByRole("separator", { name: "Resize areas", exact: true }).count(), 2);
  await filesArea.getByRole("button", { name: "Maximize area", exact: true }).click();
  assert.equal(await groups.count(), 1);
  assert.equal(await panel("Files").isVisible(), true);
  await filesArea.getByRole("button", { name: "Restore area", exact: true }).click();
  await assertRightEdge();
  await page.screenshot({ path: join(shots, "dock-windows-move-into-layout.png") });

  await filesArea.getByRole("button", { name: "Return Files to sidebar", exact: true }).click();
  await sidebar.waitFor();
  assert.equal(await groups.count(), 2);
  assert.equal(await sidebar.getAttribute("data-dock-sidebar"), "flyout");
  assert.equal(await panel("Files").getByText("Files active", { exact: true }).isVisible(), true);
  assert.equal(await draft.inputValue(), "Kept tool draft");
  assert.equal(await files.count(), 1);
  await move.focus();
  await page.keyboard.press("Space");
  await tab("Files").waitFor();
  await assertRightEdge();
  assert.equal(await draft.evaluate((element, original) => element === original, input), true, "placement and return keep the mounted tool");
  await page.reload();
  await tab("Files").waitFor();
  await assertRightEdge();
  assert.equal(await filesArea.getByRole("button", { name: "Close Files", exact: true }).isVisible(), true);

  await filesArea.getByRole("button", { name: "Close Files", exact: true }).click();
  assert.equal(await groups.count(), 2);
  assert.equal(await files.count(), 1);
  assert.equal(await files.getAttribute("aria-pressed"), "false");
  assert.equal(await sidebar.count(), 0, "closing the regular window leaves the flyout closed");
  await files.focus();
  await page.keyboard.press("Enter");
  await sidebar.waitFor();
  assert.equal(await groups.count(), 2, "keyboard rail access opens the overlay");
  await page.mouse.move(10, 100);
  await sidebar.waitFor({ state: "hidden" });
  await dockOnto(files, groups.filter({ has: tab("Chat") }), "edge-right");
  assert.deepEqual(await assertRightEdge(), placed, "the button and the right outer guide produce the same geometry");
  await dockOnto(tab("Files"), groups.filter({ has: tab("Chat") }), "group-center");
  assert.equal(await groups.count(), 2, "the placed tool can move and merge as an ordinary tab");
  assert.equal(await groups.filter({ has: tab("Chat") }).getByRole("tab", { name: "Files", exact: true }).count(), 1);
  await page.getByRole("button", { name: "Close Files", exact: true }).click();
  await view("Reset layout").click();
  assert.deepEqual(errors, []);
});

test("an obsolete saved sidebar mode reloads with the flyout closed and preserves the workspace", options, async (context) => {
  const { errors, page, tab, groups, savedLayout } = await prepare(context);
  const rail = page.getByRole("navigation", { name: "Sidebar tabs" });
  const files = rail.getByRole("button", { name: "Files", exact: true });
  const sidebar = page.locator("[data-dock-sidebar]");

  await page.evaluate(() => window.dockingFixture.setApps(["notes"]));
  await tab("Board").waitFor({ state: "detached" });
  await page.getByRole("separator", { name: "Resize areas", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  const original = await savedLayout();
  await page.evaluate(() => {
    const [key, raw] = Object.entries(localStorage).find(([key]) => key.startsWith("ragents.docking:"))!;
    localStorage.setItem(key, JSON.stringify({ ...JSON.parse(raw), side: { tab: "tool:files", mode: "docked", focused: true, width: 420 } }));
  });
  await page.reload();
  await tab("Chat").waitFor();
  assert.equal(await sidebar.count(), 0, "the obsolete mode does not reopen a sidebar");
  assert.equal(await page.getByRole("separator", { name: "Resize sidebar", exact: true }).count(), 0);
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(await groups.count(), 2);
  assert.deepEqual((await savedLayout()).root, original.root);
  await files.click();
  await sidebar.waitFor();
  assert.equal(await sidebar.getAttribute("data-dock-sidebar"), "flyout");
  await page.getByRole("button", { name: "Move into layout", exact: true }).click();
  await tab("Files").waitFor();
  assert.equal(await groups.count(), 3);
  assert.equal(await sidebar.count(), 0);
  assert.deepEqual((await savedLayout()).side, { tab: null, mode: "hidden", focused: false });
  assert.deepEqual(errors, []);
});

test("browser empty panes come from the header, behave like windows, take a dropped window, and persist", options, async (context) => {
  const { errors, page, actions, view, drop, box, press, moveTo, finishDrop, dockOnto, tab, groups } = await prepare(context);
  const empties = page.getByRole("tab", { name: "Empty space", exact: true });
  const emptyPanels = page.getByRole("tabpanel", { name: "Empty space", exact: true });
  const hints = page.getByText("Drag an app or actor here", { exact: true });
  const cards = page.locator("[data-dock-card]");
  const entry = view("Empty space");
  const intoContent = async (source: Locator, content: Locator) => {
    await press(source);
    const rect = await box(content);
    await page.mouse.move(rect.x + 24, rect.y + rect.height - 24, { steps: 8 });
  };

  await page.waitForFunction(() => document.querySelectorAll("[data-dock-group]").length === 2);
  assert.equal(await entry.getAttribute("aria-pressed"), null, "Empty space is an action, not a window state");
  assert.equal(await entry.getAttribute("title"), "Add an empty pane");
  await entry.click();
  await empties.first().waitFor();
  assert.equal(await groups.count(), 3, "a click adds an empty pane beside the focused area");
  assert.equal(await hints.first().isVisible(), true);
  await entry.click();
  await page.waitForFunction(() => document.querySelectorAll("[data-dock-group]").length === 4);
  assert.equal(await empties.count(), 2, "several empty panes are allowed");
  await page.screenshot({ path: join(shots, "dock-windows-empty-panes.png") });

  await intoContent(view("Board"), emptyPanels.first());
  await finishDrop();
  assert.equal(await empties.count(), 1, "a header button dropped on an empty pane replaces it");
  assert.equal(await groups.filter({ has: tab("Board") }).getByRole("tab").count(), 1);
  assert.equal(await groups.count(), 4);

  await intoContent(tab("Notes"), emptyPanels.first());
  const center = page.locator('[data-dock-guide="group-center"]');
  await center.waitFor();
  assert.equal(await center.getAttribute("aria-label"), "Replace empty pane");
  const guide = await box(center);
  await page.mouse.move(guide.x + guide.width / 2, guide.y + guide.height / 2, { steps: 3 });
  await finishDrop();
  assert.equal(await empties.count(), 0, "a tab dropped on the compass center of an empty pane replaces it");
  assert.equal(await groups.filter({ has: tab("Notes") }).getByRole("tab").count(), 1);
  assert.equal(await groups.count(), 3, "the emptied source area closes");

  await dockOnto(entry, cards.first(), "edge-bottom");
  assert.equal(await empties.count(), 1, "dragging Empty space onto a guide adds a pane there");
  assert.equal(await groups.count(), 4);
  assert.ok((await box(empties.first())).y > (await box(tab("Chat"))).y + 100, "the new pane spans the bottom");
  await dockOnto(empties.first(), cards.first(), "edge-left");
  assert.equal(await groups.count(), 4, "an empty pane moves like a window");
  assert.ok((await box(empties.first())).x < (await box(tab("Chat"))).x, "the pane now sits left of Chat");

  await press(entry);
  await moveTo(view("Chat"), 0.25);
  assert.equal(await drop.count(), 0, "Empty space takes no place in the header order");
  await page.mouse.up();
  assert.equal(await empties.count(), 1);
  assert.deepEqual(await actions.locator("[data-dock-window]").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))), ["Chat", "Notes", "Board"]);

  await page.reload();
  await tab("Chat").waitFor();
  await page.evaluate(() => window.dockingFixture.setApps(["notes", "board"]));
  await tab("Board").waitFor();
  assert.equal(await empties.count(), 1, "empty panes survive reload");
  assert.equal(await hints.first().isVisible(), true);
  await page.getByRole("button", { name: "Close Empty space", exact: true }).click();
  assert.equal(await empties.count(), 0, "closing an empty pane removes it");
  assert.equal(await entry.isVisible(), true, "the header entry stays");
  await entry.click();
  await empties.first().waitFor();
  await view("Reset layout").click();
  assert.equal(await empties.count(), 0, "Reset layout removes empty panes");
  assert.deepEqual(errors, []);
});

test("run header buttons stay direct at every width and count, wrap, and reorder across rows", options, async (context) => {
  const { errors, page, actions, view, drop, box, press, moveTo, tab, panel, groups, dockOnto } = await prepare(context, "?header");
  const header = page.locator("header");
  const shown = () => actions.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  const order = () => actions.locator("[data-dock-window]").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  const assertFits = async () => {
    const bounds = await box(header);
    for (const button of await header.getByRole("button").all()) {
      assert.equal(await button.isVisible(), true);
      const rect = await box(button);
      assert.ok(rect.x >= bounds.x && rect.x + rect.width <= bounds.x + bounds.width + 0.5, "every button fits the header width");
      assert.ok(rect.y >= bounds.y && rect.y + rect.height <= bounds.y + bounds.height + 0.5, "every button fits the header height");
      assert.equal(await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      }), true, "every button is directly reachable");
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "wrapping never introduces horizontal scroll");
    for (const card of await page.locator("[data-dock-card]").all()) {
      const rect = await box(card);
      assert.ok(rect.y >= bounds.y + bounds.height, "the resized dock starts below the taller header");
      assert.ok(rect.y + rect.height <= 700.5, "the dock still fits its container height");
    }
    assert.equal(await actions.getByRole("button", { name: /^All windows/ }).count(), 0);
  };

  await page.waitForFunction(() => document.querySelectorAll("[data-dock-group]").length === 2);
  assert.deepEqual(await shown(), ["Chat", "Notes", "Board", "Empty space", "Reset layout"]);
  const wideHeight = (await box(header)).height;
  await press(view("Board"));
  await moveTo(view("Chat"), 0.25);
  await drop.waitFor();
  await page.mouse.up();
  assert.deepEqual(await shown(), ["Board", "Chat", "Notes", "Empty space", "Reset layout"], "direct buttons still reorder by drag");
  await page.screenshot({ path: join(shots, "dock-windows-header-wide.png") });

  for (const width of [560, 320, 200]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForFunction(() => new Set([...document.querySelectorAll('header button')].map((button) => button.getBoundingClientRect().top)).size > 1);
    assert.deepEqual(await shown(), ["Board", "Chat", "Notes", "Empty space", "Reset layout"]);
    assert.ok((await box(header)).height > wideHeight, "the header grows when its controls do not fit one line");
    await assertFits();
    if (width <= 320) assert.ok(new Set(await actions.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top))).size > 1, "whole window buttons wrap into multiple rows");
    await page.screenshot({ path: join(shots, `dock-windows-header-${width}.png`) });
  }
  await view("Board").click();
  assert.equal(await panel("Board").isVisible(), true, "a narrow direct button opens its window");
  await view("Empty space").click();
  await tab("Empty space").waitFor();
  await view("Reset layout").click();
  await tab("Empty space").waitFor({ state: "detached" });
  assert.deepEqual(await shown(), ["Chat", "Notes", "Board", "Empty space", "Reset layout"], "direct reset restores the order");

  assert.ok((await box(view("Board"))).y > (await box(view("Chat"))).y, "the reorder target is on a later row");
  await press(view("Chat"));
  await moveTo(view("Board"), 0.75);
  await drop.waitFor();
  await page.mouse.up();
  assert.deepEqual(await order(), ["Notes", "Board", "Chat"], "dragging across rows uses both coordinates");
  await view("Chat").focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Chat");
  assert.deepEqual(await order(), ["Notes", "Chat", "Board"], "keyboard reorder keeps working across rows");
  await press(view("Board"));
  await moveTo(view("Notes"), 0.25);
  await drop.waitFor();
  await page.mouse.up();
  assert.deepEqual(await order(), ["Board", "Notes", "Chat"], "dragging back to an earlier row preserves header order");

  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByRole("button", { name: "Close Board", exact: true }).click();
  await dockOnto(view("Board"), groups.filter({ has: tab("Chat") }), "group-bottom");
  assert.equal(await panel("Board").isVisible(), true, "a wrapped button still docks onto workspace guides");
  await assertFits();
  await page.getByRole("button", { name: "first", exact: true }).click();
  await page.getByRole("dialog", { name: "Run details", exact: true }).waitFor();
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1200, height: 800 });
  await view("Reset layout").click();
  assert.equal((await box(header)).height, wideHeight, "widening restores the single-line height");
  await page.evaluate(() => window.dockingFixture.setApps(["notes", "board", "plan", "map", "log"]));
  await view("Log").waitFor();
  assert.deepEqual(await shown(), ["Chat", "Notes", "Board", "Plan", "Map", "Log", "Empty space", "Reset layout"], "more than five windows remain direct");
  await assertFits();
  await page.setViewportSize({ width: 320, height: 800 });
  await assertFits();
  assert.deepEqual(await shown(), ["Chat", "Notes", "Board", "Plan", "Map", "Log", "Empty space", "Reset layout"]);
  assert.deepEqual(errors, []);
});

test("a workspace tab placed as a window defaults to a header window that opens, docks and closes like an app", options, async (context) => {
  const { errors, page, actions, view, drop, box, press, moveTo, dockOnto, tab, panel, groups, savedLayout } = await prepare(context, "?window");
  const order = () => actions.locator("[data-dock-window]").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  const rail = page.getByRole("navigation", { name: "Sidebar tabs" });
  const railTools = () => rail.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  const draft = page.getByRole("textbox", { name: "Preview draft" });

  await page.waitForFunction(() => document.querySelectorAll("[data-dock-group]").length === 2);
  assert.deepEqual(await order(), ["Chat", "Preview", "Notes", "Board"], "the window tab follows Chat and the apps join after it");
  assert.deepEqual(await railTools(), ["Files", "Journal"], "the rail keeps only the sidebar tools");
  assert.equal(await view("Preview").getAttribute("aria-pressed"), "true", "like a first app it opens beside Chat");
  assert.equal(await panel("Preview").getByText("Preview active", { exact: true }).isVisible(), true);
  assert.equal(await view("Preview").locator('[data-slot="badge"]').textContent(), "2 checks", "its badge marks its header button");
  assert.equal(await view("Notes").locator('[data-slot="badge"]').count(), 0);
  assert.equal(await groups.filter({ has: tab("Preview") }).getByRole("button", { name: "Refresh preview", exact: true }).count(), 1, "its header contribution sits in its area header");
  assert.equal(await page.getByRole("button", { name: "Return Preview to sidebar", exact: true }).count(), 0, "a default window tab has no panel return control");
  await page.screenshot({ path: join(shots, "dock-windows-window-tab.png") });
  await draft.fill("Kept");

  await page.getByRole("button", { name: "Close Preview", exact: true }).click();
  await tab("Preview").waitFor({ state: "detached" });
  assert.equal(await view("Preview").getAttribute("aria-pressed"), "false");
  assert.deepEqual(await railTools(), ["Files", "Journal"], "closing it does not move it into the rail");
  assert.deepEqual((await savedLayout()).closed, ["tab:preview"]);
  await view("Preview").click();
  await tab("Preview").waitFor();
  assert.equal(await groups.count(), 3, "reopening it splits beside the focused area like a closed app");
  assert.equal(await draft.inputValue(), "Kept", "its panel keeps its state like a visited app");

  await press(view("Preview"));
  await moveTo(view("Chat"), 0.25);
  await drop.waitFor();
  await page.mouse.up();
  await drop.waitFor({ state: "hidden" });
  assert.deepEqual(await order(), ["Preview", "Chat", "Notes", "Board"], "it reorders among the windows");
  assert.deepEqual((await savedLayout()).order, ["tab:preview", "chat", "app:notes", "app:board"]);

  await press(tab("Preview"));
  const railBox = await box(rail);
  await page.mouse.move(railBox.x + railBox.width / 2, railBox.y + 200, { steps: 8 });
  assert.equal(await page.locator("[data-dock-preview]").count(), 0, "the rail is no drop target for a window");
  await page.mouse.up();
  await page.getByLabel("Docking guides", { exact: true }).waitFor({ state: "hidden" });
  assert.deepEqual(await railTools(), ["Files", "Journal"]);
  assert.equal(await groups.count(), 3);
  const chatArea = groups.filter({ has: tab("Chat") });
  await dockOnto(tab("Preview"), chatArea, "group-center");
  assert.equal(await chatArea.getByRole("tab", { name: "Preview", exact: true }).count(), 1, "it merges into another area as a tab");
  assert.equal(await groups.count(), 2, "its emptied area closes");

  await page.getByRole("button", { name: "Close Preview", exact: true }).click();
  await tab("Preview").waitFor({ state: "detached" });
  await page.evaluate(() => window.dockingFixture.openTab!("preview"));
  await tab("Preview").waitFor();
  assert.equal(await panel("Preview").getByText("Preview active", { exact: true }).isVisible(), true, "navigation.openTab opens the window");
  assert.equal(await tab("Preview").getAttribute("aria-selected"), "true");

  await rail.getByRole("button", { name: "Files", exact: true }).click();
  await page.locator('[data-dock-sidebar="flyout"]').waitFor();
  assert.equal(await page.getByText("Files active", { exact: true }).isVisible(), true, "a sidebar tool still opens in the sidebar");
  await page.getByRole("button", { name: "Close sidebar", exact: true }).click();

  await view("Reset layout").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-dock-group]").length === 2);
  assert.deepEqual(await order(), ["Chat", "Preview", "Notes", "Board"], "Reset layout restores the catalog order");
  assert.equal(await view("Preview").getAttribute("aria-pressed"), "true", "and opens the window tab again like an app");
  assert.deepEqual(errors, []);
});

test("a narrow run header keeps a window tab and its badge directly reachable", options, async (context) => {
  const { errors, page, actions, view, tab, panel } = await prepare(context, "?header&window");

  await page.waitForFunction(() => document.querySelectorAll("[data-dock-group]").length === 2);
  await page.getByRole("button", { name: "Close Preview", exact: true }).click();
  await tab("Preview").waitFor({ state: "detached" });
  await page.setViewportSize({ width: 320, height: 800 });
  assert.deepEqual(await actions.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
    ["Chat", "Preview", "Notes", "Board", "Empty space", "Reset layout"]);
  const preview = view("Preview");
  assert.equal(await preview.isVisible(), true);
  assert.equal(await preview.locator('[data-slot="badge"]').textContent(), "2 checks", "the direct button keeps its badge");
  assert.equal(await preview.getAttribute("aria-pressed"), "false");
  await page.screenshot({ path: join(shots, "dock-windows-window-tab-wrapped.png") });
  await preview.focus();
  await page.keyboard.press("Enter");
  await tab("Preview").waitFor();
  assert.equal(await preview.getAttribute("aria-pressed"), "true");
  assert.equal(await panel("Preview").isVisible(), true, "the direct button opens its window from the keyboard");
  assert.deepEqual(errors, []);
});

test("browser button drags move between header slots and the rail while preserving panels, persistence, and reset", options, async (context) => {
  const { errors, page, actions, view, drop, press, moveTo, box, tab, panel, savedLayout } = await prepare(context, "?header&window");
  const rail = page.getByRole("navigation", { name: "Sidebar tabs" });
  const button = (name: string) => rail.getByRole("button", { name, exact: true });
  const order = () => actions.locator("[data-dock-window]").evaluateAll((buttons) => buttons.map((element) => element.getAttribute("aria-label")));
  const samePanels = async (before: Awaited<ReturnType<typeof savedLayout>>) => {
    const after = await savedLayout();
    for (const key of ["root", "known", "closed", "bar", "side", "focused", "maximized", "automatic"]) assert.deepEqual(after[key], before[key], key);
  };
  const intoHeader = async (source: Locator, target: string, fraction = 0.25) => {
    await press(source);
    await moveTo(view(target), fraction);
    await drop.waitFor();
    await page.mouse.up();
    await drop.waitFor({ state: "hidden" });
  };
  const intoRail = async (source: Locator) => {
    await press(source);
    const bounds = await box(source);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height + 15, { steps: 4 });
    const target = await box(rail);
    await page.mouse.move(target.x + target.width / 2, target.y + target.height - 30, { steps: 8 });
    await page.locator("[data-dock-preview]").waitFor();
    await page.mouse.up();
    await page.getByLabel("Docking guides", { exact: true }).waitFor({ state: "hidden" });
  };

  await page.waitForFunction(() => document.querySelectorAll("[data-dock-group]").length === 2);
  await page.getByRole("separator", { name: "Resize areas", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await button("Files").click();
  await page.getByRole("button", { name: "Move into layout", exact: true }).click();
  await tab("Files").waitFor();
  await page.getByRole("textbox", { name: "Files draft" }).fill("Kept selection");
  const placed = await savedLayout();
  await intoHeader(button("Files"), "Chat");
  assert.deepEqual(await order(), ["Files", "Chat", "Preview", "Notes", "Board"]);
  assert.equal(await button("Files").count(), 0);
  assert.equal(await view("Files").getAttribute("aria-pressed"), "true");
  assert.equal(await panel("Files").isVisible(), true);
  assert.equal(await page.getByRole("textbox", { name: "Files draft" }).inputValue(), "Kept selection");
  await samePanels(placed);
  await intoRail(view("Files"));
  await button("Files").waitFor();
  await samePanels(placed);
  await page.getByRole("button", { name: "Close Files", exact: true }).click();

  const preview = await savedLayout();
  await intoRail(view("Preview"));
  await button("Preview").waitFor();
  assert.equal(await panel("Preview").isVisible(), true, "moving an open window button leaves its docked panel open");
  assert.equal(await button("Preview").locator('[data-slot="badge"]').textContent(), "2 checks");
  await samePanels(preview);
  await page.evaluate(() => { document.documentElement.style.zoom = "1.3"; });
  await intoHeader(button("Preview"), "Notes");
  assert.deepEqual(await order(), ["Chat", "Preview", "Notes", "Board"], "insertion follows the pointer under zoom");
  await samePanels(preview);
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });

  await button("Files").click();
  await page.getByRole("button", { name: "Move into layout", exact: true }).click();
  await tab("Files").waitFor();
  await page.getByRole("button", { name: "Close Board", exact: true }).click();
  const closed = await savedLayout();
  await intoRail(view("Board"));
  await button("Board").waitFor();
  assert.equal(await panel("Board").isVisible(), false, "moving a closed button does not open its panel");
  await samePanels(closed);
  await button("Board").hover();
  await panel("Board").waitFor();
  const previewed = await savedLayout();
  assert.deepEqual(previewed.root, closed.root, "hovering a closed rail entry only previews its panel");
  await intoHeader(button("Board"), "Chat");
  await page.mouse.move(10, 100);
  await panel("Board").waitFor({ state: "hidden" });
  assert.equal(await panel("Board").isVisible(), false);
  await samePanels(previewed);

  await intoHeader(button("Journal"), "Chat");
  await intoHeader(button("Files"), "Reset layout", 0.5);
  assert.equal(await rail.count(), 0, "the empty rail disappears outside a drag");
  await intoRail(view("Notes"));
  await button("Notes").waitFor();
  assert.equal(await panel("Notes").isVisible(), false, "a background tab stays in the background");
  const placements = (await savedLayout()).placements;
  await page.reload();
  await tab("Chat").waitFor();
  await button("Notes").waitFor();
  assert.deepEqual((await savedLayout()).placements["app:notes"], placements["app:notes"]);
  assert.equal(await view("Files").isVisible(), true);
  assert.equal(await view("Journal").isVisible(), true);
  await page.evaluate(() => window.dockingFixture.setRun("second"));
  await button("Files").waitFor();
  assert.equal(await view("Notes").isVisible(), true, "another run uses its plugin defaults");
  await page.evaluate(() => window.dockingFixture.setRun("first"));
  await button("Notes").waitFor();
  assert.equal(await view("Files").isVisible(), true, "returning to a run restores its choice");
  await view("Reset layout").click();
  assert.deepEqual(await order(), ["Chat", "Preview", "Notes"]);
  assert.deepEqual(await rail.getByRole("button").evaluateAll((buttons) => buttons.map((element) => element.getAttribute("aria-label"))), ["Files", "Journal"]);
  assert.equal((await savedLayout()).placements, undefined);
  assert.equal((await savedLayout()).order, undefined);
  assert.deepEqual(errors, []);
});

test("browser context menus move buttons in both directions by keyboard and pointer without opening or closing panels", options, async (context) => {
  const { errors, page, view, panel, tab, savedLayout } = await prepare(context, "?header&window");
  const rail = page.getByRole("navigation", { name: "Sidebar tabs" });
  const button = (name: string) => rail.getByRole("button", { name, exact: true });
  const menuMove = async (source: Locator, destination: "header" | "sidebar", keyboard = true) => {
    if (keyboard) {
      await source.focus();
      await page.keyboard.press("Shift+F10");
      const item = page.getByRole("menuitem", { name: `Move to ${destination}`, exact: true });
      await item.waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "menuitem");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
    } else {
      await source.click({ button: "right" });
      await page.getByRole("menuitem", { name: `Move to ${destination}`, exact: true }).click();
    }
    await page.getByRole("menu").waitFor({ state: "hidden" });
  };

  await page.waitForFunction(() => document.querySelectorAll("[data-dock-group]").length === 2);
  const hidden = await savedLayout();
  await menuMove(button("Files"), "header");
  await view("Files").waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-dock-window") === "tool:files");
  assert.deepEqual((await savedLayout()).root, hidden.root);
  assert.deepEqual((await savedLayout()).side, hidden.side);
  assert.equal(await page.getByRole("tabpanel", { name: "Files", exact: true }).count(), 0, "the hidden tool stays hidden");
  await menuMove(view("Files"), "sidebar");
  await button("Files").waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-dock-rail-button") === "tool:files");
  assert.deepEqual((await savedLayout()).side, hidden.side);

  await menuMove(view("Notes"), "sidebar");
  await button("Notes").waitFor();
  assert.deepEqual((await savedLayout()).root, hidden.root);
  assert.equal(await panel("Notes").isVisible(), false, "the background app stays in its tab");
  await menuMove(button("Notes"), "header");
  assert.deepEqual((await savedLayout()).root, hidden.root);

  await view("Notes").focus();
  await page.keyboard.press("Enter");
  const notes = panel("Notes");
  await notes.getByRole("textbox", { name: "App draft", exact: true }).fill("App draft survives");
  await notes.frameLocator('iframe[title="App frame"]').getByRole("textbox", { name: "Frame draft", exact: true }).fill("Frame draft survives");
  const frame = await notes.locator('iframe[title="App frame"]').elementHandle();
  await page.waitForFunction((element) => typeof Reflect.get((element as HTMLIFrameElement).contentWindow!, "identity") === "number", frame);
  const identity = await frame!.evaluate((element) => Reflect.get((element as HTMLIFrameElement).contentWindow!, "identity"));
  const mounts = await page.evaluate(() => window.dockingFixture.mounts.notes);
  await menuMove(view("Notes"), "sidebar");
  assert.equal(await notes.isVisible(), true);
  await menuMove(button("Notes"), "header");
  assert.equal(await notes.getByRole("textbox", { name: "App draft", exact: true }).inputValue(), "App draft survives");
  assert.equal(await notes.frameLocator('iframe[title="App frame"]').getByRole("textbox", { name: "Frame draft", exact: true }).inputValue(), "Frame draft survives");
  assert.equal(await notes.locator('iframe[title="App frame"]').evaluate((element, original) => element === original, frame), true);
  assert.equal(await frame!.evaluate((element) => Reflect.get((element as HTMLIFrameElement).contentWindow!, "identity")), identity);
  assert.equal(await page.evaluate(() => window.dockingFixture.mounts.notes), mounts);

  await tab("Preview").click();
  await page.getByRole("textbox", { name: "Preview draft" }).fill("Kept draft");
  await menuMove(view("Preview"), "sidebar", false);
  assert.equal(await panel("Preview").isVisible(), true);
  await menuMove(button("Preview"), "header", false);
  assert.equal(await page.getByRole("textbox", { name: "Preview draft" }).inputValue(), "Kept draft");
  assert.equal(await panel("Preview").isVisible(), true);
  await menuMove(view("Chat"), "sidebar");
  assert.equal(await panel("Chat").isVisible(), true, "Chat uses the same placement path");
  await view("Reset layout").click();
  assert.equal((await savedLayout()).placements, undefined);
  assert.equal(await view("Chat").isVisible(), true);
  assert.equal(await view("Preview").isVisible(), true);
  assert.equal(await button("Preview").count(), 0);
  assert.deepEqual(errors, []);
});

test("browser active dock tabs are square fills flush with a strip clipped to the card corners", options, async (context) => {
  const { errors, page, tab } = await prepare(context);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    const shape = await tab("Chat").evaluate((element) => {
      const fill = element.parentElement!;
      const strip = fill.parentElement!;
      const style = getComputedStyle(fill);
      const stripStyle = getComputedStyle(strip);
      const rect = fill.getBoundingClientRect();
      const bounds = strip.getBoundingClientRect();
      return { radius: style.borderRadius, left: rect.left - bounds.left, top: rect.top - bounds.top,
        height: bounds.height - rect.height, padding: stripStyle.padding, gap: stripStyle.gap,
        overflow: stripStyle.overflow, corner: parseFloat(stripStyle.borderTopLeftRadius) };
    });
    assert.equal(shape.radius, "0px");
    assert.equal(shape.left, 0);
    assert.equal(shape.top, 0);
    assert.equal(shape.height, 1, "only the strip's bottom border separates the fill from the panel");
    assert.equal(shape.padding, "0px");
    assert.ok(shape.gap === "normal" || shape.gap === "0px");
    assert.equal(shape.overflow, "hidden");
    assert.ok(shape.corner > 0);
    await page.screenshot({ path: join(shots, `dock-tabs-square-${theme}.png`) });
  }
  assert.deepEqual(errors, []);
});
