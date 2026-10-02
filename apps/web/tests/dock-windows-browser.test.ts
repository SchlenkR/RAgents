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

test("a run header too narrow for the window buttons lists every window, Empty space and Reset layout in one menu", options, async (context) => {
  const { errors, page, actions, view, drop, box, press, moveTo, tab, panel } = await prepare(context, "?header");
  const menuButton = actions.getByRole("button", { name: /^All windows/ });
  const menu = page.getByRole("menu", { name: "All windows" });
  const entries = () => menu.locator('[role^="menuitem"]').evaluateAll((items) => items.map((item) => [item.textContent, item.getAttribute("aria-checked")]));
  const shown = () => actions.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  const fitsBeforeAgents = async () => {
    const group = await box(actions);
    return group.x + group.width <= (await box(page.getByRole("button", { name: "Agents", exact: true }))).x + 0.5;
  };

  await page.waitForFunction(() => document.querySelectorAll("[data-dock-group]").length === 2);
  assert.deepEqual(await shown(), ["Chat", "Notes", "Board", "Empty space", "Reset layout"], "a wide run header shows every button and no menu");
  await press(view("Board"));
  await moveTo(view("Chat"), 0.25);
  await drop.waitFor();
  await page.mouse.up();
  assert.deepEqual(await shown(), ["Board", "Chat", "Notes", "Empty space", "Reset layout"], "the buttons in the run header still reorder by drag");
  await page.screenshot({ path: join(shots, "dock-windows-header-wide.png") });

  await page.setViewportSize({ width: 560, height: 800 });
  await menuButton.waitFor();
  assert.deepEqual(await shown(), ["All windows, Chat"], "a narrow run header keeps only the menu, named after the focused window");
  assert.equal(await menuButton.textContent(), "Chat");
  assert.ok(await fitsBeforeAgents(), "the menu stays clear of the other header actions");
  await menuButton.click();
  await menu.waitFor();
  assert.deepEqual(await entries(), [["Board", "false"], ["Chat", "true"], ["Notes", "false"], ["Empty space", null], ["Reset layout", null]],
    "the menu lists every window in the saved order with the visible ones checked, then Empty space and Reset layout");
  await menu.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
  await page.screenshot({ path: join(shots, "dock-windows-narrow-menu.png") });
  await menu.getByRole("menuitemcheckbox", { name: "Board", exact: true }).click();
  await menu.waitFor({ state: "hidden" });
  assert.equal(await panel("Board").isVisible(), true, "a menu entry shows its window");
  assert.equal(await menuButton.getAttribute("aria-label"), "All windows, Board");

  await menuButton.click();
  await menu.getByRole("menuitem", { name: "Empty space", exact: true }).click();
  await tab("Empty space").waitFor();
  assert.equal(await menuButton.getAttribute("aria-label"), "All windows, Empty space", "Empty space in the menu adds an empty pane and focuses it");
  await menuButton.click();
  await menu.getByRole("menuitem", { name: "Reset layout", exact: true }).click();
  await tab("Empty space").waitFor({ state: "detached" });
  await menuButton.focus();
  await page.keyboard.press("Enter");
  await menu.waitFor();
  assert.deepEqual((await entries()).map(([name]) => name), ["Chat", "Notes", "Board", "Empty space", "Reset layout"], "Reset layout in the menu restores the order");
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "menuitemcheckbox" && document.activeElement.textContent === "Chat");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await menu.waitFor({ state: "hidden" });
  assert.equal(await panel("Board").isVisible(), true, "the menu works from the keyboard");

  await page.setViewportSize({ width: 320, height: 800 });
  assert.ok(await fitsBeforeAgents(), "the menu also fits the narrowest run header");
  await page.setViewportSize({ width: 1200, height: 800 });
  await view("Chat").waitFor();
  assert.deepEqual(await shown(), ["Chat", "Notes", "Board", "Empty space", "Reset layout"], "widening the header brings the buttons back");
  assert.ok(await fitsBeforeAgents());

  await page.evaluate(() => window.dockingFixture.setApps(["notes", "board", "plan", "map", "log"]));
  await menuButton.waitFor();
  assert.equal(await view("Chat").count(), 0, "more than five windows use the menu at any width");
  await menuButton.click();
  await menu.waitFor();
  assert.deepEqual((await entries()).map(([name]) => name), ["Chat", "Notes", "Board", "Plan", "Map", "Log", "Empty space", "Reset layout"]);
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
});
