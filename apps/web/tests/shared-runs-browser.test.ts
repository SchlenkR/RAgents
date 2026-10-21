import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./shared-runs-fixture";

const buildFixture = async (directory: string) => {
  const sources = fileURLToPath(new URL("../src/", import.meta.url));
  const fixtures = fileURLToPath(new URL("./", import.meta.url));
  await build({
    entryPoints: [join(fixtures, "shared-runs-fixture.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    outfile: join(directory, "fixture.js"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [tailwindPlugin([sources, fixtures])], logLevel: "silent",
  });
  await writeFile(join(directory, "index.html"), '<!doctype html><html class="h-full"><head><meta charset="utf-8"><title>Shared runs</title><link rel="stylesheet" href="fixture.css"></head><body class="h-full"><div class="h-full" id="root"></div><script src="fixture.js"></script></body></html>');
  return pathToFileURL(join(directory, "index.html")).href;
};

for (const host of ["browser", "vscode"]) {
  test(`the shared run view lists only owned shares, searches recipients and revokes directly in ${host}`, {
    skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 90_000,
  }, async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "ragents-shared-runs-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const url = await buildFixture(directory);
    const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
    context.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: host === "browser" ? 1100 : 520, height: 950 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(6000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}?host=${host}`);
    const allTab = page.getByRole("tab", { name: "All runs", exact: true });
    const sharedTab = page.getByRole("tab", { name: "Shared by me 3", exact: true });
    await allTab.waitFor();
    assert.equal(await allTab.getAttribute("aria-selected"), "true");
    assert.equal(await page.getByRole("list", { name: "Runs", exact: true }).getByRole("listitem").count(), 23);
    await sharedTab.click();
    const shared = page.getByRole("list", { name: "Runs shared by me", exact: true });
    const cards = shared.locator(":scope > li");
    await shared.waitFor();
    assert.equal(await allTab.getAttribute("aria-selected"), "false");
    assert.equal(await sharedTab.getAttribute("aria-selected"), "true");
    assert.equal(await cards.count(), 3);
    assert.deepEqual(await cards.locator(":scope > div").getByRole("button", { name: /^(Design review|Release checklist|Read-only draft)$/ }).allTextContents(), ["Design review", "Release checklist", "Read-only draft"]);
    for (const name of ["Private draft", "Admin-visible run", "Received review"]) assert.equal(await shared.getByText(name, { exact: true }).count(), 0);
    const recipients = page.getByRole("list", { name: "Recipients of Design review", exact: true });
    assert.deepEqual(await recipients.getByRole("listitem").allTextContents(), ["EveryoneViewRevoke", "BobViewRevoke", "CarolOperateRevoke"]);
    assert.equal(await page.getByRole("button", { name: "Revoke all sharing for Read-only draft", exact: true }).isDisabled(), true, "a read-only owner sees their shares without getting a revoke action");
    const screenshots = join(tmpdir(), "ragents-browser-shots");
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({ animations: "disabled", path: join(screenshots, `shared-runs-${host}.png`) });
    await shared.getByRole("button", { name: "Design review", exact: true }).click();
    assert.equal(await page.getByRole("status", { name: "Opened run" }).textContent(), "review");

    const search = page.getByRole("searchbox", { name: "Search runs", exact: true });
    await search.fill(" bOb ");
    assert.equal(await cards.count(), 1, "recipient search trims and ignores case");
    await search.fill("release");
    assert.equal(await cards.count(), 1, "the same search also matches run titles");
    await search.fill("everyone");
    assert.equal(await cards.count(), 2, "everyone grants are searchable");
    await search.fill("not found");
    assert.equal(await page.getByRole("status").filter({ hasText: "No matching shared run." }).count(), 1);
    await search.fill("");

    await page.evaluate(() => { window.sharedRunsFixture.holdRevoke = true; });
    await page.getByRole("button", { name: "Revoke individual share with Bob for Design review", exact: true }).click();
    await page.waitForFunction(() => window.sharedRunsFixture.actions.some((action) => action.action === "revokeShare"));
    for (const button of await shared.getByRole("button", { name: /^Revoke/ }).all()) assert.equal(await button.isDisabled(), true, "revoke actions wait for the server response");
    assert.equal(await sharedTab.getAttribute("aria-selected"), "true", "a revoke keeps the shared tab open");
    await page.evaluate(() => { window.sharedRunsFixture.holdRevoke = false; window.sharedRunsFixture.finishRevoke(); });
    await page.getByRole("button", { name: "Revoke individual share with Bob for Design review", exact: true }).waitFor({ state: "hidden" });
    assert.equal(await recipients.getByText("Everyone", { exact: true }).count(), 1);
    assert.equal(await recipients.getByText("Carol", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Revoking an individual share keeps the access granted to everyone.", { exact: true }).count(), 1);
    await page.getByRole("button", { name: "Revoke sharing with everyone for Design review", exact: true }).click();
    await recipients.getByText("Everyone", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await recipients.getByText("Carol", { exact: true }).count(), 1, "revoking everyone keeps the remaining individual share");

    await page.evaluate(() => { window.sharedRunsFixture.failRevoke = true; });
    await page.getByRole("button", { name: "Revoke all sharing for Release checklist", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Sharing could not be revoked. Try again." }).waitFor();
    assert.equal(await page.getByRole("list", { name: "Recipients of Release checklist", exact: true }).getByText("Carol", { exact: true }).count(), 1, "a refusal keeps the share visible");
    assert.equal(await page.getByRole("button", { name: "Revoke all sharing for Release checklist", exact: true }).isEnabled(), true);
    await page.evaluate(() => { window.sharedRunsFixture.failRevoke = false; });
    await page.getByRole("button", { name: "Revoke all sharing for Release checklist", exact: true }).click();
    await page.getByRole("tab", { name: "Shared by me 2", exact: true }).waitFor();
    assert.equal(await shared.getByText("Release checklist", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("alert").count(), 0);
    await page.getByRole("button", { name: "Revoke all sharing for Design review", exact: true }).click();
    await page.getByRole("tab", { name: "Shared by me 1", exact: true }).waitFor();
    assert.equal(await cards.count(), 1);
    await page.evaluate(() => { window.sharedRunsFixture.share("readonly", { everyone: null, users: [] }); });
    await page.getByRole("tab", { name: "Shared by me 0", exact: true }).waitFor();
    await page.getByRole("status").filter({ hasText: "You have not shared any runs." }).waitFor();
    await allTab.click();
    assert.equal(await page.getByRole("list", { name: "Runs", exact: true }).getByRole("listitem").count(), 23, "taking back a share never deletes the run");
    assert.deepEqual(await page.evaluate(() => window.sharedRunsFixture.actions.filter((action) => action.action === "revokeShare")), [
      { action: "revokeShare", name: "workshop", runId: "review", target: { kind: "user", userId: "bob" } },
      { action: "revokeShare", name: "workshop", runId: "review", target: { kind: "everyone" } },
      { action: "revokeShare", name: "workshop", runId: "release", target: { kind: "all" } },
      { action: "revokeShare", name: "workshop", runId: "release", target: { kind: "all" } },
      { action: "revokeShare", name: "workshop", runId: "review", target: { kind: "all" } },
    ]);
    assert.deepEqual(errors, []);
  });
}
