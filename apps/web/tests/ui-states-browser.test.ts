import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, type Locator } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";

const contrast = (foreground: string, background: string) => {
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    assert.equal(channels?.length, 3, `RGB color required: ${color}`);
    const linear = channels!.map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

const styleOf = (locator: Locator) => locator.evaluate(async (element) => {
  const style = getComputedStyle(element);
  await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
  return { background: style.backgroundColor, color: style.color, border: style.borderBottomColor,
    borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
    radius: style.borderRadius, edge: getComputedStyle(element, "::after").content,
    shadow: style.boxShadow, opacity: style.opacity, pointerEvents: style.pointerEvents, textDecoration: style.textDecorationLine };
});

test("shared controls retain readable states and status tones in both themes", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-ui-states-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("ui-states-fixture.tsx", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}apps/web/tests`])], logLevel: "silent" });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(5000);
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  const tones = ["success", "warning", "danger", "info", "neutral", "active"] as const;
  const toneTokens = { success: "success", warning: "warning", danger: "destructive", info: "info", neutral: "muted-foreground", active: "active" };

  for (const theme of ["light", "dark"]) {
    await page.goto(pathToFileURL(join(directory, "index.html")).href);
    await button("Selected toggle").waitFor();
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    const tokens = await page.evaluate(() => {
      const names = ["background", "foreground", "hover", "hover-foreground", "selected", "selected-hover", "selected-foreground", "selected-border", "ring", "primary", "primary-hover", "primary-foreground", "secondary", "muted-foreground", "success", "success-soft", "warning", "warning-soft", "destructive", "destructive-soft", "info", "info-soft", "active", "active-soft"];
      const sample = document.createElement("span");
      document.documentElement.append(sample);
      const values = Object.fromEntries(names.map((name) => {
        sample.style.color = `var(--${name})`;
        return [name, getComputedStyle(sample).color];
      }));
      sample.remove();
      return values;
    });
    const selected = async (control: Locator, label: string) => {
      await page.mouse.move(0, 0);
      const before = await styleOf(control);
      assert.ok([tokens.selected, tokens["selected-hover"]].includes(before.background), `${label}: selected background`);
      assert.equal(before.color, tokens["selected-foreground"], `${label}: selected foreground`);
      assert.equal(before.shadow, "none", `${label}: selection adds no shadow or ring`);
      assert.deepEqual(before.borderWidths, ["1px", "1px", "1px", "1px"], `${label}: selection has a uniform one-pixel border`);
      assert.equal(before.border, tokens["selected-border"], `${label}: selection border uses its hue`);
      assert.ok(contrast(before.color, before.background) >= 4.5, `${label}: selected text reaches AA`);
      await control.hover();
      const hovered = await styleOf(control);
      assert.notEqual(hovered.background, tokens.hover, `${label}: selection remains distinct from ordinary hover`);
      assert.equal(hovered.background, tokens["selected-hover"], `${label}: hover gently strengthens selection`);
      assert.equal(hovered.shadow, "none", `${label}: selected hover stays flat`);
      assert.equal(hovered.color, before.color, `${label}: hover retains selected text`);
    };
    const hover = async (control: Locator, label: string) => {
      await page.mouse.move(0, 0);
      const before = await styleOf(control);
      await control.hover();
      const hovered = await styleOf(control);
      assert.equal(hovered.background, tokens.hover, `${label}: shared hover background`);
      assert.equal(hovered.color, tokens["hover-foreground"], `${label}: shared hover foreground`);
      assert.notEqual(hovered.background, before.background, `${label}: hover changes the surface`);
      assert.ok(contrast(hovered.color, hovered.background) >= 4.5, `${label}: hover text reaches AA`);
    };

    await context.test(`${theme}: selected controls survive hover`, async (state) => {
      const controls: readonly [Locator, string][] = [
        ...["default", "outline", "secondary", "ghost", "destructive", "link"].map((variant): [Locator, string] => [button(`Pressed ${variant}`), `pressed ${variant}`]),
        [button("Expanded action"), "expanded action"], [button("Selected toggle"), "toggle"],
        [button("Selected outline toggle"), "outline toggle"], [button("Read option"), "multiple option"],
        [button("Write option"), "second multiple option"], [button("List mode"), "segmented option"],
        [page.getByRole("tab", { name: "Overview default", exact: true }), "default tab"],
        [page.getByRole("tab", { name: "Overview line", exact: true }), "line tab"],
        [button("Current page"), "current page"], [button("Current item"), "current item"],
        [page.getByRole("row", { name: "Selected row", exact: true }), "selected row"],
      ];
      for (const [control, label] of controls) await state.test(label, () => selected(control, label));
    });

    await context.test(`${theme}: ordinary actions and rows share visible hover`, async () => {
      for (const name of ["Action outline", "Action secondary", "Action ghost", "Action link", "Unselected toggle", "Share option", "Grid mode", "Other page", "Inactive item"]) await hover(button(name), name);
      for (const name of ["Details default", "Details line"]) await hover(page.getByRole("tab", { name, exact: true }), name);
      await hover(page.getByRole("row", { name: "Unselected row", exact: true }), "unselected row");
      await button("Action default").hover();
      const primary = await styleOf(button("Action default"));
      assert.equal(primary.background, tokens["primary-hover"]);
      assert.ok(contrast(primary.color, primary.background) >= 4.5, "primary hover text reaches AA");
      await page.mouse.move(0, 0);
      const beforeDestructive = await styleOf(button("Action destructive"));
      await button("Action destructive").hover();
      const destructive = await styleOf(button("Action destructive"));
      assert.notEqual(destructive.background, beforeDestructive.background, "destructive hover gently changes the background");
      assert.equal(destructive.shadow, "none", "destructive hover adds no ring");
      assert.ok(contrast(destructive.color, destructive.background) >= 4.5, "destructive hover text reaches AA");
    });

    await context.test(`${theme}: controls update selection through user input`, async () => {
      await button("Unselected toggle").click();
      assert.equal(await button("Unselected toggle").getAttribute("aria-pressed"), "true");
      await selected(button("Unselected toggle"), "newly selected toggle");
      await button("Share option").click();
      assert.equal(await button("Read option").getAttribute("aria-pressed"), "true");
      assert.equal(await button("Write option").getAttribute("aria-pressed"), "true");
      await selected(button("Share option"), "new multiple option");
      await button("Grid mode").click();
      assert.equal(await button("List mode").getAttribute("aria-pressed"), "false");
      await selected(button("Grid mode"), "new segmented option");
      for (const variant of ["default", "line"]) {
        await page.getByRole("tab", { name: `Details ${variant}`, exact: true }).click();
        assert.equal(await page.getByRole("tab", { name: `Overview ${variant}`, exact: true }).getAttribute("aria-selected"), "false");
        await selected(page.getByRole("tab", { name: `Details ${variant}`, exact: true }), "new tab");
      }
    });

    await context.test(`${theme}: tabs and icon toggles stay flat under pointer input`, async () => {
      for (const variant of ["default", "line"]) {
        const tab = page.getByRole("tab", { name: `Details ${variant}`, exact: true });
        await tab.click();
        const style = await styleOf(tab);
        assert.equal(style.radius, "0px", "tabs have square corners");
        assert.equal(style.shadow, "none", "pointer selection has no focus ring");
        assert.equal(style.edge, "none", "tabs have no added indicator edge");
      }
      for (const name of ["Pin", "Maximize"]) {
        const icon = button(name);
        for (const pressed of [true, false]) {
          await icon.evaluate((element, value) => element.setAttribute("aria-pressed", String(value)), pressed);
          await icon.click();
          const style = await styleOf(icon);
          assert.deepEqual(style.borderWidths, ["0px", "0px", "0px", "0px"], "icon controls have no border");
          assert.equal(style.shadow, "none", "icon controls have no pointer ring");
        }
        await page.keyboard.press("Tab");
        await icon.focus();
        const focused = await styleOf(icon);
        assert.deepEqual(focused.borderWidths, ["0px", "0px", "0px", "0px"], "icon keyboard focus stays borderless");
        assert.equal(focused.shadow, "none", "icon keyboard focus has no ring");
        assert.notEqual(focused.background, "rgba(0, 0, 0, 0)", "icon keyboard focus remains visible through its background");
      }
    });

    await context.test(`${theme}: disabled controls retain a distinct appearance`, async () => {
      for (const control of [button("Disabled action"), button("Disabled pressed action"), button("Disabled toggle"), button("Disabled option"), button("Disabled item"), page.getByRole("tab", { name: "Disabled default", exact: true }), page.getByRole("tab", { name: "Disabled line", exact: true })]) {
        assert.equal(await control.isDisabled(), true);
        const style = await styleOf(control);
        assert.ok(Number(style.opacity) <= 0.5, "disabled controls are visually muted");
        assert.equal(style.pointerEvents, "none");
      }
      assert.equal((await styleOf(button("Disabled pressed action"))).background, tokens.selected, "disabled selection stays visible");
    });

    await context.test(`${theme}: keyboard focus uses the same visible ring`, async () => {
      await page.mouse.move(0, 0);
      await page.keyboard.press("Tab");
      for (const control of [button("Action outline"), button("Unselected toggle"), button("Grid mode"), page.getByRole("tab", { name: "Details default", exact: true }), button("Current page"), page.getByRole("row", { name: "Unselected row", exact: true }), page.getByRole("combobox", { name: "Single choice", exact: true })]) {
        await control.focus();
        assert.equal(await control.evaluate((element) => element.matches(":focus-visible")), true);
        const style = await styleOf(control);
        assert.ok(style.shadow.includes(tokens.ring), `focus ring uses the theme token: ${style.shadow}`);
        assert.match(style.shadow, /0px 0px 0px 2px/, "one-pixel focus ring surrounds a one-pixel offset");
      }
      assert.ok(contrast(tokens.ring, tokens.background) >= 3, "focus ring reaches non-text contrast");
    });

    await context.test(`${theme}: tones reach AA and dot badges keep accessible text`, async () => {
      for (const tone of tones) {
        const badge = page.getByRole("status").filter({ hasText: `Status ${tone}` });
        const style = await styleOf(badge);
        assert.equal(style.color, tokens[toneTokens[tone]], `${tone}: status foreground`);
        assert.equal(style.background, tokens[tone === "neutral" ? "secondary" : `${toneTokens[tone]}-soft`], `${tone}: status background`);
        const ratio = contrast(style.color, style.background);
        assert.ok(ratio >= 4.5, `${theme} ${tone}: ${ratio.toFixed(2)} contrast reaches AA`);
        const dot = page.getByRole("status").filter({ hasText: `Dot ${tone}` });
        assert.equal((await styleOf(dot)).background, tokens[toneTokens[tone]], `${tone}: dot keeps its tone`);
        assert.ok((await dot.ariaSnapshot()).includes(`Dot ${tone}`), "dot text remains in the accessibility tree");
        const geometry = await dot.evaluate((element) => ({ width: element.getBoundingClientRect().width, textWidth: element.firstElementChild!.getBoundingClientRect().width }));
        assert.ok(geometry.width >= 7 && geometry.width <= 9, "dot remains compact");
        assert.ok(geometry.textWidth <= 1, "dot text is visually hidden");
      }
      assert.ok(contrast(tokens["hover-foreground"], tokens.hover) >= 4.5);
      assert.ok(contrast(tokens["selected-foreground"], tokens.selected) >= 4.5);
      for (const token of ["foreground", "muted-foreground", "primary", "success", "warning", "destructive", "info", "active"]) {
        assert.ok(contrast(tokens[token], tokens.selected) >= 4.5, `${theme} ${token}: child text on selected surfaces reaches AA`);
      }
    });

    await context.test(`${theme}: summary items keep native keyboard disclosure`, async () => {
      const summary = page.getByText("Item details", { exact: true });
      const content = page.getByText("Expanded item information", { exact: true });
      assert.equal(await content.isVisible(), false);
      await summary.focus();
      await page.keyboard.press("Enter");
      await content.waitFor();
      await page.keyboard.press("Space");
      await content.waitFor({ state: "hidden" });
      await hover(summary, "summary item");
    });

    await context.test(`${theme}: linked status tones retain readable semantic colors on hover`, async () => {
      for (const variant of ["default", "ghost", "destructive"]) for (const tone of tones) {
        const name = `Linked ${tone} ${variant}`;
        const badge = page.getByRole("link", { name, exact: true });
        await page.mouse.move(0, 0);
        const before = await styleOf(badge);
        assert.equal(before.color, tokens[toneTokens[tone]], `${name}: status foreground`);
        assert.equal(before.background, tokens[tone === "neutral" ? "secondary" : `${toneTokens[tone]}-soft`], `${name}: status background`);
        await badge.hover();
        const hovered = await styleOf(badge);
        assert.equal(hovered.color, before.color, `${name}: hover retains the tone foreground`);
        assert.equal(hovered.background, before.background, `${name}: hover retains the tone surface`);
        assert.ok(contrast(hovered.color, hovered.background) >= 4.5, `${name}: hovered status text reaches AA`);
        assert.ok(hovered.textDecoration.includes("underline"), `${name}: hover marks the link`);
      }
    });

    await context.test(`${theme}: select and checked menu items retain selection`, async () => {
      await page.getByRole("combobox", { name: "Single choice", exact: true }).click();
      const chosen = page.getByRole("option", { name: "First option", exact: true });
      await chosen.waitFor();
      assert.equal(await chosen.getAttribute("data-selected"), "", "Base UI emits an empty selected attribute");
      await selected(chosen, "selected select item");
      await hover(page.getByRole("option", { name: "Second option", exact: true }), "unselected select item");
      const disabledOption = page.getByRole("option", { name: "Disabled select option", exact: true });
      assert.equal(await disabledOption.isDisabled(), true);
      assert.ok(Number((await styleOf(disabledOption)).opacity) <= 0.5);
      await page.keyboard.press("Escape");
      await chosen.waitFor({ state: "hidden" });
      await button("Display menu").click();
      const checked = page.getByRole("menuitemcheckbox", { name: "Checked item", exact: true });
      await checked.waitFor();
      assert.equal(await checked.getAttribute("aria-checked"), "true");
      await selected(checked, "checked menu item");
      await selected(page.getByRole("menuitemradio", { name: "Compact item", exact: true }), "radio menu item");
      await hover(page.getByRole("menuitemcheckbox", { name: "Unchecked item", exact: true }), "unchecked menu item");
      const disabledItem = page.getByRole("menuitem", { name: "Disabled menu item", exact: true });
      assert.equal(await disabledItem.isDisabled(), true);
      assert.ok(Number((await styleOf(disabledItem)).opacity) <= 0.5);
      await page.keyboard.press("Escape");
      await checked.waitFor({ state: "hidden" });
    });
    if (process.env.RAGENTS_SCREENSHOT_DIR) {
      await mkdir(process.env.RAGENTS_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.RAGENTS_SCREENSHOT_DIR, `${process.env.RAGENTS_SCREENSHOT_PREFIX ?? "ui"}-ui-states-${theme}.png`) });
    }
  }
  assert.deepEqual(errors, []);
});
