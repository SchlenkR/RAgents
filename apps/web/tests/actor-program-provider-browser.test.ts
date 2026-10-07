import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import type {} from "./actor-program-provider-fixture";

test("actor program listings recover with bounded retries and discard disposed run, API and mutation responses", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-provider-browser-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  await build({entryPoints: [fileURLToPath(new URL("actor-program-provider-fixture.tsx", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"), logLevel: "silent"});
  await writeFile(join(directory, "index.html"), '<!doctype html><html><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const open = async () => {
    await page.goto(pathToFileURL(join(directory, "index.html")).href);
    await page.getByRole("alert").waitFor();
  };
  const data = () => page.getByLabel("Provider data").textContent();
  await open();
  await page.evaluate(() => { window.actorProgramProviderFixture.mode = "success"; window.actorProgramProviderFixture.render(); });
  await page.waitForFunction(() => window.actorProgramProviderFixture.current?.listing !== undefined);
  assert.equal(await page.getByLabel("Provider error").textContent(), "");
  assert.equal(await page.evaluate(() => window.actorProgramProviderFixture.listCalls.length), 2, "an ordinary rerender recovers through its scheduled retry");

  await open();
  await page.waitForFunction(() => window.actorProgramProviderFixture.listCalls.length === 4);
  await page.waitForTimeout(700);
  const times = await page.evaluate(() => window.actorProgramProviderFixture.listCalls.map((call) => call.time));
  assert.equal(times.length, 4, "automatic retries stop after three attempts");
  assert.ok(times[1]! - times[0]! >= 450 && times[2]! - times[1]! >= 1400 && times[3]! - times[2]! >= 3900, "retries use increasing delays");
  await page.evaluate(() => { window.actorProgramProviderFixture.mode = "success"; });
  await page.getByRole("button", {name: "Retry", exact: true}).click();
  await page.waitForFunction(() => window.actorProgramProviderFixture.current?.listing !== undefined);
  assert.equal(await page.evaluate(() => window.actorProgramProviderFixture.listCalls.length), 5);
  await page.evaluate(async () => { const f = window.actorProgramProviderFixture; f.mode = "fail"; await f.current!.refresh(); });
  await page.evaluate(() => { const f = window.actorProgramProviderFixture; f.mode = "success"; window.dispatchEvent(new Event("online")); });
  await page.waitForFunction(() => window.actorProgramProviderFixture.current?.error === undefined);
  await page.evaluate(async () => {
    const f = window.actorProgramProviderFixture;
    f.mode = "fail"; f.connected = false; f.render();
  });
  await page.waitForFunction(() => window.actorProgramProviderFixture.current?.error !== undefined);
  await page.evaluate(() => { const f = window.actorProgramProviderFixture; f.mode = "success"; f.connected = true; f.render(); });
  await page.waitForFunction(() => window.actorProgramProviderFixture.current?.error === undefined);
  await page.evaluate(async () => { await window.actorProgramProviderFixture.current!.invoke("counter--board", "build", "step", "failed", null).catch(() => undefined); });
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => window.actorProgramProviderFixture.mutationCalls), 1, "mutations never retry");

  await open();
  await page.evaluate(() => {
    const f = window.actorProgramProviderFixture; f.mode = "defer"; void f.current!.refresh();
  });
  await page.waitForFunction(() => window.actorProgramProviderFixture.pendingLists.length === 1);
  await page.evaluate(() => { const f = window.actorProgramProviderFixture; f.mode = "success"; f.runId = "other"; f.render(); });
  await page.waitForFunction(() => window.actorProgramProviderFixture.current?.runId === "other" && window.actorProgramProviderFixture.current.listing !== undefined);
  const otherData = await data();
  assert.equal(await page.evaluate(() => window.actorProgramProviderFixture.pendingLists[0]!.signal?.aborted), true);
  await page.evaluate(() => { window.actorProgramProviderFixture.pendingLists[0]!.resolve(); });
  await page.waitForTimeout(50);
  assert.equal(await data(), otherData, "the old run's late success cannot replace the new run");
  await page.evaluate(() => { const f = window.actorProgramProviderFixture; f.mode = "defer"; void f.current!.refresh(); });
  await page.waitForFunction(() => window.actorProgramProviderFixture.pendingLists.length === 2);
  await page.evaluate(() => { const f = window.actorProgramProviderFixture; f.mode = "success"; f.source = "secondary"; f.render(); });
  await page.waitForFunction(() => window.actorProgramProviderFixture.current?.listing?.apps[0]?.state.values.source === "secondary");
  await page.evaluate(() => { window.actorProgramProviderFixture.pendingLists[1]!.reject(); });
  await page.waitForTimeout(50);
  assert.equal(await page.getByLabel("Provider error").textContent(), "", "the old API's late failure cannot publish an error or schedule retries");
  await page.evaluate(() => {
    const f = window.actorProgramProviderFixture; f.mutationPending = true;
    void f.current!.invoke("counter--board", "build", "step", "late", null);
  });
  await page.waitForFunction(() => window.actorProgramProviderFixture.completeMutation !== undefined);
  await page.evaluate(() => { const f = window.actorProgramProviderFixture; f.runId = "third"; f.render(); });
  await page.waitForFunction(() => window.actorProgramProviderFixture.current?.runId === "third" && window.actorProgramProviderFixture.current.listing !== undefined);
  await page.evaluate(() => { window.actorProgramProviderFixture.completeMutation!(); });
  await page.waitForTimeout(50);
  assert.deepEqual(await page.evaluate(() => window.actorProgramProviderFixture.current!.listing!.apps[0]!.invocations), [], "an old run's mutation completion cannot change the current run");

  await page.evaluate(() => { const f = window.actorProgramProviderFixture; f.mode = "defer"; void f.current!.refresh(); });
  await page.waitForFunction(() => window.actorProgramProviderFixture.pendingLists.length === 3);
  await page.evaluate(async () => { const f = window.actorProgramProviderFixture; f.mode = "success"; await f.current!.refresh(); f.pendingLists[2]!.reject(); });
  await page.waitForTimeout(600);
  assert.equal(await page.getByLabel("Provider error").textContent(), "", "a superseded request in the current run cannot schedule a retry or replace current state");

  await open();
  await page.evaluate(async () => { const f = window.actorProgramProviderFixture; f.mode = "success"; f.polling = true; await f.current!.refresh(); f.mode = "fail"; });
  await page.waitForFunction(() => window.actorProgramProviderFixture.current?.listing?.apps[0]?.invocations[0]?.status === "succeeded");
  await page.waitForTimeout(1100);
  assert.ok(await page.evaluate(() => window.actorProgramProviderFixture.pollCalls.filter((id) => id === "second").length) >= 2,
    "the remaining active invocation keeps polling when completion triggers a failing listing refresh");
  await page.evaluate(() => window.actorProgramProviderFixture.unmount());

  await open();
  const unmountedCalls = await page.evaluate(() => { const f = window.actorProgramProviderFixture; f.unmount(); return f.listCalls.length; });
  await page.waitForTimeout(750);
  assert.equal(await page.evaluate(() => window.actorProgramProviderFixture.listCalls.length), unmountedCalls, "unmount cancels retries");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  assert.equal(await page.evaluate(() => window.actorProgramProviderFixture.listCalls.length), unmountedCalls, "unmount removes reconnect listeners");

  await open();
  await page.evaluate(() => { const f = window.actorProgramProviderFixture; f.mode = "defer"; void f.current!.refresh(); });
  await page.waitForFunction(() => window.actorProgramProviderFixture.pendingLists.length === 1);
  const pendingCalls = await page.evaluate(() => {
    const f = window.actorProgramProviderFixture; f.unmount(); f.pendingLists[0]!.reject(); return f.listCalls.length;
  });
  await page.waitForTimeout(750);
  assert.equal(await page.evaluate(() => window.actorProgramProviderFixture.pendingLists[0]!.signal?.aborted), true, "unmount aborts a pending list request");
  assert.equal(await page.evaluate(() => window.actorProgramProviderFixture.listCalls.length), pendingCalls, "a rejected request after disposal schedules no retry");
  for (const outcome of ["success", "failure"] as const) {
    await open();
    await page.evaluate(async () => { const f = window.actorProgramProviderFixture; f.mode = "success"; await f.current!.refresh(); });
    await page.evaluate(() => {
      const f = window.actorProgramProviderFixture;
      f.mutationPending = true;
      void f.current!.invoke("counter--board", "build", "step", "pending", null).catch(() => undefined);
      f.mode = "defer"; f.extraView = true; f.render();
    });
    await page.waitForFunction(() => window.actorProgramProviderFixture.pendingLists.length === 1);
    await page.evaluate((result) => {
      const f = window.actorProgramProviderFixture; f.mode = "success";
      if (result === "success") f.completeMutation!();
      else f.rejectMutation!();
    }, outcome);
    await page.waitForFunction(() => window.actorProgramProviderFixture.current?.listing?.apps.length === 2);
    await page.evaluate(() => window.actorProgramProviderFixture.pendingLists[0]!.resolve());
    assert.deepEqual(await page.evaluate(() => window.actorProgramProviderFixture.current!.listing!.apps.map((app) => app.id)),
      ["counter--board", "counter--details"], `a newly installed view survives a concurrent invocation ${outcome}`);
    assert.equal(await page.evaluate(() => window.actorProgramProviderFixture.mutationCalls), 1);
  }
  assert.deepEqual(errors, []);
});
