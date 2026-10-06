import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, type Locator } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";

const geometryOf = (control: Locator) => control.evaluate((element) => {
  const bounds = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const native = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
  if (native) {
    const mirror = document.createElement("div");
    Object.assign(mirror.style, { position: "absolute", left: "-10000px", whiteSpace: "pre", font: style.font, lineHeight: style.lineHeight, padding: "0", border: "0" });
    mirror.textContent = element.value || element.placeholder || "Control";
    document.body.append(mirror);
    const range = document.createRange();
    range.selectNodeContents(mirror);
    const text = range.getBoundingClientRect();
    const line = mirror.getBoundingClientRect();
    const glyphOffset = text.y + text.height / 2 - line.y - line.height / 2;
    const top = parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
    const bottom = parseFloat(style.borderBottomWidth) + parseFloat(style.paddingBottom);
    const lineCenter = element instanceof HTMLTextAreaElement ? bounds.y + top + line.height / 2 : bounds.y + top + (bounds.height - top - bottom) / 2;
    mirror.remove();
    return { height: bounds.height, textOffset: lineCenter + glyphOffset - bounds.y - bounds.height / 2 };
  }
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim() || node.parentElement?.closest("svg")) continue;
    const range = document.createRange();
    range.selectNode(node);
    const text = range.getBoundingClientRect();
    if (text.width > 1 && text.height > 1) return { height: bounds.height, textOffset: text.y + text.height / 2 - bounds.y - bounds.height / 2 };
  }
  return { height: bounds.height, textOffset: null };
});

const popupGeometry = (popup: Locator) => popup.evaluate(async (element) => {
  await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
  const bounds = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, radius: style.borderRadius };
});

test("shared control sizes, searchable dropdowns and multi-value filters work in the browser", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-ui-controls-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("ui-controls-fixture.tsx", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}apps/web/tests`])], logLevel: "silent" });
  await writeFile(join(directory, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1560, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()) && /controlled|uncontrolled|invalid prop|does not recognize|render prop/i.test(message.text())) errors.push(message.text());
  });
  const origin = pathToFileURL(join(directory, "index.html")).href;
  const shots = join(tmpdir(), "ragents-browser-shots");
  await mkdir(shots, { recursive: true });
  const reset = async () => { await page.goto(origin); await page.getByRole("heading", { name: "Shared controls", exact: true }).waitFor(); };
  const close = async (popup: Locator) => { await page.keyboard.press("Escape"); await popup.waitFor({ state: "hidden" }); };
  const selectPopup = () => page.locator('[data-slot="select-content"][data-open]');
  const selectedText = async (trigger: Locator) => (await trigger.locator('[data-slot="select-value"]').textContent())?.trim();

  for (const theme of ["light", "dark"]) for (const width of [1560, 540]) {
    await context.test(`${theme}, ${width}px: every size has equal control heights and text centers`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await reset();
      await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
      for (const size of ["xs", "sm", "default", "lg"]) {
        const row = page.getByRole("toolbar", { name: `${size} controls`, exact: true });
        const controls = [
          row.getByRole("button", { name: `${size} button`, exact: true }),
          row.getByRole("button", { name: `${size} icon button`, exact: true }),
          row.getByRole("button", { name: `${size} toggle`, exact: true }),
          row.getByRole("group", { name: `${size} view`, exact: true }),
          row.getByRole("group", { name: `${size} permissions`, exact: true }),
          row.getByLabel(`${size} select`, { exact: true }),
          row.getByLabel(`${size} input`, { exact: true }),
          row.getByLabel(`${size} combobox`, { exact: true }),
          row.getByRole("combobox", { name: /^Status/ }),
          row.getByLabel(`${size} textarea`, { exact: true }),
        ];
        const geometries = await Promise.all(controls.map(geometryOf));
        const expected = geometries[0];
        for (let index = 0; index < geometries.length; index++) {
          const geometry = geometries[index];
          assert.ok(Math.abs(geometry.height - expected.height) < 0.01, `${size} control ${index}: ${geometry.height}px, expected ${expected.height}px`);
          if (geometry.textOffset !== null && expected.textOffset !== null) assert.ok(Math.abs(geometry.textOffset - expected.textOffset) <= 1, `${size} control ${index}: text offset ${geometry.textOffset}px, expected ${expected.textOffset}px`);
        }
        for (const label of [`${size} view`, `${size} permissions`]) {
          const group = row.getByRole("group", { name: label, exact: true });
          const geometry = await group.evaluate((element) => {
            const style = getComputedStyle(element);
            return { radius: style.borderRadius, gap: style.gap, borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
              height: element.getBoundingClientRect().height,
              segments: [...element.querySelectorAll("button")].map((item) => {
                const bounds = item.getBoundingClientRect();
                const segmentStyle = getComputedStyle(item);
                return { x: bounds.x, width: bounds.width, height: bounds.height, radius: segmentStyle.borderRadius,
                  borders: [segmentStyle.borderTopWidth, segmentStyle.borderRightWidth, segmentStyle.borderBottomWidth, segmentStyle.borderLeftWidth] };
              }) };
          });
          assert.equal(geometry.radius, "0px", label);
          assert.equal(geometry.gap, "0px", label);
          assert.deepEqual(geometry.borders, ["1px", "1px", "1px", "1px"], `${label}: one shared border`);
          for (const [index, segment] of geometry.segments.entries()) {
            assert.equal(segment.radius, "0px", `${label}: square segment ${index}`);
            assert.deepEqual(segment.borders, ["0px", "0px", "0px", index === 0 ? "0px" : "1px"], `${label}: only one divider`);
            assert.equal(segment.height, geometry.height - 2, `${label}: fills the group's inner height`);
            if (index > 0) assert.ok(Math.abs(segment.x - geometry.segments[index - 1].x - geometry.segments[index - 1].width) < 0.01, `${label}: no gap or overlapping borders`);
          }
        }
      }
      if (theme === "light" && width === 1560) await page.getByRole("region", { name: "Control sizes" }).screenshot({ path: join(shots, "shared-controls-toolbar.png") });
    });
  }
  await page.setViewportSize({ width: 1560, height: 900 });

  await context.test("controlled and uncontrolled segments support roving keyboard focus and disabled options", async () => {
    await reset();
    const view = page.getByRole("group", { name: "Board view", exact: true });
    const list = view.getByRole("button", { name: "List", exact: true });
    const lanes = view.getByRole("button", { name: "Lanes", exact: true });
    assert.equal(await view.getByRole("button", { name: "Timeline", exact: true }).isDisabled(), true);
    assert.equal(await view.locator('[tabindex="0"]').count(), 1, "a group has a single tab stop");
    await list.focus();
    await list.press("ArrowRight");
    assert.equal(await lanes.evaluate((element) => element === document.activeElement), true, "arrows skip the disabled segment");
    assert.equal(await page.getByLabel("Board view value", { exact: true }).textContent(), "list", "focus movement does not change selection");
    const focus = await lanes.evaluate((element) => ({ visible: element.matches(":focus-visible"), shadow: getComputedStyle(element).boxShadow }));
    assert.equal(focus.visible, true);
    assert.notEqual(focus.shadow, "none", "keyboard focus is visible");
    await lanes.press("Enter");
    assert.equal(await list.getAttribute("aria-pressed"), "false");
    assert.equal(await lanes.getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByLabel("Board view value", { exact: true }).textContent(), "lanes");
    await lanes.press("Home");
    await list.press("Space");
    assert.equal(await page.getByLabel("Board view value", { exact: true }).textContent(), "list");
    await list.press("End");
    assert.equal(await lanes.evaluate((element) => element === document.activeElement), true);
    await lanes.press("ArrowRight");
    assert.equal(await list.evaluate((element) => element === document.activeElement), true, "focus loops");
    await list.press("Space");
    assert.equal(await page.getByLabel("Board view value", { exact: true }).textContent(), "None", "ordinary ToggleGroup permits clearing its sole selection");
    const grouping = page.getByRole("group", { name: "Grouping", exact: true });
    await grouping.getByRole("button", { name: "No grouping", exact: true }).click();
    assert.equal(await grouping.getByRole("button", { name: "By story", exact: true }).getAttribute("aria-pressed"), "false");
    assert.equal(await grouping.getByRole("button", { name: "No grouping", exact: true }).getAttribute("aria-pressed"), "true");
    const disabled = page.getByRole("group", { name: "Disabled view", exact: true });
    for (const button of await disabled.getByRole("button").all()) assert.equal(await button.isDisabled(), true);
    const vertical = page.getByRole("group", { name: "Vertical view", exact: true });
    const verticalList = vertical.getByRole("button", { name: "List", exact: true });
    const verticalLanes = vertical.getByRole("button", { name: "Lanes", exact: true });
    await verticalList.focus();
    await verticalList.press("ArrowDown");
    assert.equal(await verticalLanes.evaluate((element) => element === document.activeElement), true);
    await verticalLanes.press("Space");
    assert.equal(await verticalLanes.getAttribute("aria-pressed"), "true");
    const divider = await verticalLanes.evaluate((element) => ({ top: getComputedStyle(element).borderTopWidth, left: getComputedStyle(element).borderLeftWidth }));
    assert.deepEqual(divider, { top: "1px", left: "0px" });
    const verticalHeight = await geometryOf(verticalLanes);
    const buttonHeight = await geometryOf(page.getByLabel("default button", { exact: true }));
    assert.equal(verticalHeight.height, buttonHeight.height, "vertical segments retain the shared control height");
  });

  await context.test("short single and multiple filters retain choices when their lists grow into dropdowns", async () => {
    await reset();
    const choice = page.getByRole("group", { name: "Short choice", exact: true });
    for (const segment of await choice.getByRole("button").all()) {
      const label = await segment.locator("span").evaluate((element) => ({ width: element.clientWidth, content: element.scrollWidth }));
      assert.ok(label.content <= label.width, "segments show complete labels when space is available");
    }
    await choice.getByRole("button", { name: "Beta follow-up", exact: true }).click();
    await choice.getByRole("button", { name: "Beta follow-up", exact: true }).click();
    assert.equal(await page.getByLabel("Short choice value", { exact: true }).textContent(), "beta", "ChoiceSelect retains a required single choice");
    const stages = page.getByRole("group", { name: "Short stages", exact: true });
    const alpha = stages.getByRole("button", { name: /^Alpha research/ });
    const beta = stages.getByRole("button", { name: /^Beta follow-up/ });
    await alpha.focus();
    await alpha.press("Space");
    await alpha.press("ArrowRight");
    await beta.press("Enter");
    assert.equal(await alpha.getAttribute("aria-pressed"), "true");
    assert.equal(await beta.getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByLabel("Short filter values", { exact: true }).textContent(), "alpha,beta");
    await page.getByRole("button", { name: "Use six values", exact: true }).click();
    assert.equal(await page.getByRole("group", { name: "Short stages", exact: true }).count(), 0);
    const trigger = page.getByLabel("Short choice", { exact: true });
    assert.equal(await selectedText(trigger), "Beta follow-up");
    await trigger.click();
    await selectPopup().getByRole("option", { name: "Beta follow-up", selected: true, exact: true }).waitFor();
    await close(selectPopup());
    await page.getByRole("combobox", { name: /^Short stages:/ }).click();
    const popup = page.locator('[data-slot="filter-select-content"]');
    await popup.waitFor();
    assert.equal(await popup.getByRole("option", { selected: true }).count(), 2);
    await close(popup);
    await page.getByRole("button", { name: "Use five values", exact: true }).click();
    assert.equal(await beta.getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Clear Short stages", exact: true }).click();
    assert.equal(await page.getByLabel("Short filter values", { exact: true }).textContent(), "All");
    assert.equal(await page.getByRole("button", { name: "Clear Short stages", exact: true }).isDisabled(), true);
    const permissions = page.getByRole("group", { name: "default permissions", exact: true });
    await permissions.getByRole("button", { name: "Share", exact: true }).click();
    assert.equal(await permissions.getByRole("button", { pressed: true }).count(), 3, "uncontrolled multiple groups retain earlier choices");
    for (const button of await page.getByRole("group", { name: "Disabled stages", exact: true }).getByRole("button").all()) assert.equal(await button.isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Clear Disabled stages", exact: true }).isDisabled(), true);
    await page.getByRole("region", { name: "Segmented controls", exact: true }).screenshot({ path: join(shots, "shared-controls-segments.png") });
    await page.setViewportSize({ width: 320, height: 900 });
    const available = await page.getByRole("region", { name: "Segmented controls", exact: true }).boundingBox();
    assert.ok(available);
    for (const label of ["Short choice", "Short stages"]) {
      const bounds = await page.getByRole("group", { name: label, exact: true }).boundingBox();
      assert.ok(bounds && bounds.width <= available.width && bounds.x + bounds.width <= available.x + available.width, `${label}: fits a narrow pane`);
    }
    assert.equal(await beta.getAttribute("title"), "Beta follow-up", "truncated segment labels retain the full text on hover");
    await page.setViewportSize({ width: 1560, height: 900 });
  });

  await context.test("Select opens outside its trigger, stays at least as wide, and flips above near the bottom", async () => {
    await reset();
    for (const label of ["Searchable select", "Eight option select"]) {
      const trigger = page.getByLabel(label, { exact: true });
      await trigger.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await trigger.click();
      await selectPopup().waitFor();
      const triggerBounds = await trigger.boundingBox();
      const popup = await popupGeometry(selectPopup());
      assert.ok(triggerBounds);
      assert.ok(popup.y >= triggerBounds.y + triggerBounds.height, `${label}: popup starts at ${popup.y}, trigger ends at ${triggerBounds.y + triggerBounds.height}`);
      assert.ok(popup.width >= triggerBounds.width, `${label}: popup width ${popup.width}px is at least trigger width ${triggerBounds.width}px`);
      assert.equal(popup.radius, "0px", "Select uses square dropdown corners");
      await close(selectPopup());
    }
    for (const label of ["Bottom select", "Bottom searchable select"]) {
      const bottom = page.getByLabel(label, { exact: true });
      await bottom.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await bottom.click();
      await selectPopup().waitFor();
      const bottomBounds = await bottom.boundingBox();
      const flipped = await popupGeometry(selectPopup());
      assert.ok(bottomBounds);
      assert.ok(flipped.y + flipped.height <= bottomBounds.y + 0.1, `${label}: popup flips above without covering the trigger`);
      assert.ok(flipped.width >= bottomBounds.width);
      await close(selectPopup());
    }
  });

  await context.test("Select search matches labels case-insensitively and keyboard selection uses filtered options", async () => {
    await reset();
    await page.getByLabel("Searchable select", { exact: true }).click();
    const popup = selectPopup();
    const search = popup.getByRole("combobox", { name: "Filter options", exact: true });
    await search.fill("BeTa");
    await popup.getByRole("option", { name: "Beta follow-up", exact: true }).waitFor();
    assert.equal(await popup.getByRole("option").count(), 1);
    assert.equal(await popup.getByRole("option", { name: "Alpha research", exact: true }).count(), 0);
    await page.screenshot({ path: join(shots, "shared-controls-select-filter.png") });
    await search.press("ArrowDown");
    await search.press("Enter");
    await popup.waitFor({ state: "hidden" });
    assert.equal(await page.getByLabel("Selected option", { exact: true }).textContent(), "beta");
    assert.equal(await selectedText(page.getByLabel("Searchable select", { exact: true })), "Beta follow-up");
    await page.getByLabel("Searchable select", { exact: true }).click();
    await search.fill("REVIEW");
    assert.equal(await popup.getByRole("option").count(), 2);
    await search.press("ArrowDown");
    await search.press("ArrowDown");
    await search.press("Enter");
    await popup.waitFor({ state: "hidden" });
    assert.equal(await page.getByLabel("Selected option", { exact: true }).textContent(), "iota", "two ArrowDown presses reach the second filtered option");
  });

  await context.test("Select reports empty searches, Escape closes, and opening again resets the filter", async () => {
    await reset();
    const trigger = page.getByLabel("Searchable select", { exact: true });
    await trigger.click();
    const popup = selectPopup();
    const search = popup.getByRole("combobox", { name: "Filter options", exact: true });
    await search.fill("No matching stage");
    await popup.getByText("No matching options.", { exact: true }).waitFor();
    assert.equal(await popup.getByRole("option").count(), 0);
    assert.equal(await page.getByLabel("Selected option", { exact: true }).textContent(), "gamma");
    await close(popup);
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Searchable select");
    assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
    await trigger.click();
    assert.equal(await search.inputValue(), "");
    assert.equal(await popup.getByRole("option").count(), 9);
    await close(popup);
  });

  await context.test("Select search defaults to more than eight options and supports explicit overrides", async () => {
    await reset();
    for (const [label, searchable] of [["Eight option select", false], ["Search forced on", true], ["Search forced off", false]] as const) {
      await page.getByLabel(label, { exact: true }).click();
      await selectPopup().waitFor();
      assert.equal(await selectPopup().getByRole("combobox", { name: "Filter options", exact: true }).count(), searchable ? 1 : 0, label);
      await close(selectPopup());
    }
  });

  await context.test("the exported Combobox also filters and selects directly", async () => {
    await reset();
    const trigger = page.getByLabel("default combobox", { exact: true });
    await trigger.click();
    const popup = page.locator('[data-slot="combobox-content"][data-open]');
    const search = popup.getByRole("combobox", { name: "Filter options", exact: true });
    await search.fill("SECOND");
    await popup.getByRole("option", { name: "Second choice", exact: true }).waitFor();
    assert.equal(await popup.getByRole("option").count(), 1);
    await search.press("ArrowDown");
    await search.press("Enter");
    await popup.waitFor({ state: "hidden" });
    assert.equal((await trigger.textContent())?.trim(), "Second choice");
  });

  await context.test("an uncontrolled Select retains its chosen value when its option count crosses the search threshold", async () => {
    await reset();
    const trigger = page.getByLabel("Changing options select", { exact: true });
    await trigger.click();
    await selectPopup().getByRole("option", { name: "Delta review", exact: true }).click();
    await selectPopup().waitFor({ state: "hidden" });
    assert.equal(await selectedText(trigger), "Delta review");
    await page.getByRole("button", { name: "Use nine options", exact: true }).click();
    assert.equal(await selectedText(trigger), "Delta review");
    await trigger.click();
    const search = selectPopup().getByRole("combobox", { name: "Filter options", exact: true });
    await search.fill("Beta");
    await search.press("ArrowDown");
    await search.press("Enter");
    await selectPopup().waitFor({ state: "hidden" });
    assert.equal(await selectedText(trigger), "Beta follow-up");
    await page.getByRole("button", { name: "Use eight options", exact: true }).click();
    assert.equal(await selectedText(trigger), "Beta follow-up");
    await trigger.click();
    await selectPopup().waitFor();
    assert.equal(await selectPopup().getByRole("combobox", { name: "Filter options", exact: true }).count(), 0);
    await selectPopup().getByRole("option", { name: "Beta follow-up", exact: true, selected: true }).waitFor();
    await close(selectPopup());
  });

  await context.test("a searchable multiple Select retains hidden values and toggles filtered options with the keyboard", async () => {
    await reset();
    const trigger = page.getByLabel("Multiple stages select", { exact: true });
    await trigger.click();
    const popup = selectPopup();
    const search = popup.getByRole("combobox", { name: "Filter options", exact: true });
    await search.fill("Beta");
    await search.press("ArrowDown");
    await search.press("Enter");
    assert.equal(await popup.isVisible(), true, "multiple Select stays open after choosing a value");
    assert.equal(await page.getByLabel("Selected select values", { exact: true }).textContent(), "alpha,beta");
    assert.equal(await popup.getByRole("option", { name: "Beta follow-up", exact: true, selected: true }).count(), 1);
    await search.fill("Alpha");
    assert.equal(await popup.getByRole("option", { name: "Alpha research", exact: true, selected: true }).count(), 1);
    await search.press("ArrowDown");
    await search.press("Enter");
    assert.equal(await page.getByLabel("Selected select values", { exact: true }).textContent(), "beta");
    await search.fill("");
    assert.equal(await popup.getByRole("option", { name: "Beta follow-up", exact: true, selected: true }).count(), 1);
    await close(popup);
    assert.equal(await selectedText(trigger), "Beta follow-up");
  });

  await context.test("FilterSelect keeps multiple choices, counts them, searches, and clears all values", async () => {
    await reset();
    const trigger = page.getByRole("combobox", { name: /^Stages:/ });
    assert.match(await trigger.innerText(), /All/);
    await trigger.click();
    const popup = page.locator('[data-slot="filter-select-content"]');
    await popup.waitFor();
    const search = popup.getByRole("combobox", { name: "Filter options", exact: true });
    const alpha = popup.getByRole("option", { name: /Alpha research/ });
    const beta = popup.getByRole("option", { name: /Beta follow-up/ });
    await alpha.click();
    assert.equal(await alpha.getAttribute("aria-selected"), "true");
    await beta.click();
    assert.equal(await beta.getAttribute("aria-selected"), "true");
    assert.equal(await popup.isVisible(), true, "choosing a filter keeps its popup open");
    assert.match(await trigger.innerText(), /2/);
    assert.equal(await page.getByLabel("Selected filters", { exact: true }).textContent(), "alpha,beta");
    assert.equal(await popup.getByRole("option", { name: /Theta archive/ }).isDisabled(), true);
    await search.fill("BeTa");
    assert.equal(await popup.getByRole("option").count(), 1);
    assert.equal(await beta.getAttribute("aria-selected"), "true", "filtering retains checked values");
    assert.match(await beta.innerText(), /7/, "option count remains visible");
    assert.equal((await popupGeometry(popup)).radius, "0px");
    await page.screenshot({ path: join(shots, "shared-controls-filter-select.png") });
    await search.press("ArrowDown");
    await search.press("Enter");
    assert.equal(await beta.getAttribute("aria-selected"), "false", "Enter toggles the matching value in a multi-select filter");
    assert.equal(await page.getByLabel("Selected filters", { exact: true }).textContent(), "alpha");
    assert.equal(await popup.isVisible(), true);
    await search.fill("No matching stage");
    await popup.getByText("No matching options.", { exact: true }).waitFor();
    await popup.getByRole("button", { name: "Clear", exact: true }).click();
    assert.equal(await page.getByLabel("Selected filters", { exact: true }).textContent(), "All");
    assert.match(await trigger.innerText(), /All/);
    await close(popup);
    const unfiltered = page.getByRole("combobox", { name: /^Unfiltered stages:/ });
    await unfiltered.press("ArrowDown");
    await popup.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "listbox");
    assert.equal(await popup.getByRole("combobox", { name: "Filter options", exact: true }).count(), 0);
    const triggerBounds = await unfiltered.boundingBox();
    const popupBounds = await popupGeometry(popup);
    assert.ok(triggerBounds);
    assert.ok(popupBounds.y >= triggerBounds.y + triggerBounds.height, "a filter without search anchors below its trigger");
    assert.ok(popupBounds.width >= triggerBounds.width, "a filter without search is at least as wide as its trigger");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const keyboardState = await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 500), highlighted: [...document.querySelectorAll('[data-slot="filter-select-content"] [data-highlighted]')].map((item) => item.textContent) }));
    assert.match(await page.getByLabel("Selected filters", { exact: true }).textContent() ?? "", /^(alpha|beta|gamma|delta|epsilon|zeta|eta|iota)$/, JSON.stringify(keyboardState));
    assert.equal(await popup.getByRole("option", { selected: true }).count(), 1, "a filter without search remains keyboard selectable");
    await close(popup);
  });

  await context.test("dropdown menus, context menus and popovers use the same square panel corners", async () => {
    await reset();
    await page.getByRole("button", { name: "Actions", exact: true }).click();
    const menu = page.getByRole("menu");
    await menu.waitFor();
    assert.equal((await popupGeometry(menu)).radius, "0px");
    await close(menu);
    await page.getByRole("button", { name: "Details", exact: true }).click();
    const popover = page.getByLabel("Item details", { exact: true });
    await popover.waitFor();
    assert.equal((await popupGeometry(popover)).radius, "0px");
    await close(popover);
    await page.getByRole("button", { name: "Window actions", exact: true }).click({ button: "right" });
    await menu.waitFor();
    assert.equal((await popupGeometry(menu)).radius, "0px");
    await close(menu);
  });
  assert.deepEqual(errors, []);
});
