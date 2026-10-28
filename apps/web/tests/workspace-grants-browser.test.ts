import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import { chromium } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./workspace-grants-fixture";

const browserOnly = { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000 };
const fixtureRpc: Plugin = {
  name: "workspace-grants-rpc",
  setup(build) {
    build.onLoad({ filter: /\/apps\/web\/src\/rpc\.ts$/ }, () => ({
      contents: "export const rpc = { call: (contract, input) => window.workspaceGrantsFixture.call(contract.id, input) };",
      loader: "ts",
    }));
  },
};

async function fixturePage(context: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "ragents-workspace-grants-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("workspace-grants-fixture.tsx", import.meta.url))], bundle: true,
    platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    plugins: [fixtureRpc, tailwindPlugin([`${root}apps/web/src`, `${root}plugins/ragents.workspace/web`])], logLevel: "silent" });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
  page.setDefaultTimeout(8000);
  return { page, url: pathToFileURL(join(directory, "index.html")).href };
}

test("access cards send each decision through the workspace method and show actual grants", browserOnly, async (context) => {
  const { page, url } = await fixturePage(context);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [decision, button] of [["allow", "Allow"], ["allow-folder", "Allow folder"], ["deny", "Deny"]]) {
    await page.goto(url + "?write");
    const card = page.getByRole("group", { name: "Access request", exact: true });
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[aria-label="Access decision"] button')?.disabled);
    await card.getByText("Read and write", { exact: true }).waitFor();
    await card.getByRole("button", { name: button, exact: true }).click();
    await card.getByRole("status").waitFor();
    assert.deepEqual(await page.evaluate(() => window.workspaceGrantsFixture.calls.at(-1)), {
      method: "ragents.workspace.accessRequest.answer", input: { runId: "example-run", actionId: "example-action", decision },
    });
    if (decision === "deny") {
      await card.getByText("Access denied.", { exact: true }).waitFor();
      assert.equal(await page.getByRole("list", { name: "Granted paths" }).count(), 0);
    } else {
      await card.getByText(decision === "allow" ? "Access allowed." : "Folder access allowed.", { exact: true }).waitFor();
      assert.equal(await page.getByRole("list", { name: "Granted paths" }).getByRole("listitem").count(), 1);
    }
  }
  assert.equal(await page.locator("[title]").count(), 0);
  assert.deepEqual(errors, []);
});

test("shared and restricted viewers cannot answer, directories have no folder choice, and errors permit retry", browserOnly, async (context) => {
  const { page, url } = await fixturePage(context);
  for (const parameter of ["shared", "restricted", "offline"]) {
    await page.goto(`${url}?${parameter}`);
    const buttons = page.getByRole("group", { name: "Access decision", exact: true }).getByRole("button");
    await buttons.first().waitFor();
    for (const button of await buttons.all()) assert.equal(await button.isDisabled(), true);
    if (parameter === "shared") await page.getByText("Only the run's owner may answer access requests.", { exact: true }).waitFor();
    if (parameter === "restricted") await page.getByText("The server requires isolated access (PROCESS_SANDBOX=on).", { exact: true }).waitFor();
    if (parameter === "offline") await page.getByText("Reconnect to answer this request.", { exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.workspaceGrantsFixture.calls)).some((call) => call.method === "ragents.workspace.accessRequest.answer"), false);
  }
  await page.goto(url + "?directory");
  assert.equal(await page.getByRole("button", { name: "Allow folder", exact: true }).count(), 0);
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[aria-label="Access decision"] button')?.disabled);
  await page.evaluate(() => window.workspaceGrantsFixture.setAnswerError("The requested path changed; request access again."));
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await page.getByRole("alert").getByText("The requested path changed; request access again.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Allow", exact: true }).isDisabled(), false);
  await page.evaluate(() => window.workspaceGrantsFixture.setAnswerError(undefined));
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await page.getByText("Access denied.", { exact: true }).waitFor();
});

test("access cards use the spacing scale and wrap long paths at narrow widths", browserOnly, async (context) => {
  const { page, url } = await fixturePage(context);
  for (const width of [700, 360]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto(url);
    const card = page.getByRole("group", { name: "Access request", exact: true });
    await card.waitFor();
    const geometry = await card.evaluate((element) => {
      const computed = getComputedStyle(element);
      const unit = parseFloat(computed.getPropertyValue("--spacing")) * parseFloat(getComputedStyle(document.documentElement).fontSize);
      const decision = element.querySelector('[aria-label="Access decision"]')!;
      return { width: element.clientWidth, scrollWidth: element.scrollWidth, gap: parseFloat(computed.gap), decisionGap: parseFloat(getComputedStyle(decision).gap), unit };
    });
    assert.ok(geometry.scrollWidth <= geometry.width + 1);
    assert.ok(Math.abs(geometry.gap - geometry.unit * 3) < 0.1);
    assert.ok(Math.abs(geometry.decisionGap - geometry.unit * 2) < 0.1);
  }
});
