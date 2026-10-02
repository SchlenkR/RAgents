import assert from "node:assert/strict";
import test from "node:test";
import { isNativeTool } from "@ragents/engine";
import type { ActorProgramsService, ActorViewReference } from "../src/plugin-support/actor-programs/service.ts";
import type { RunBrowser } from "../../../plugins/ragents.browser/server/browser.ts";
import { createViewSnapshotFunction, viewAddress } from "../../../plugins/ragents.browser/server/view-snapshot.ts";

const view: ActorViewReference = { reference: "counter/main", elementId: "counter--main", visible: true };

const fixture = (options: { view?: ActorViewReference; navigate?: () => Promise<unknown>; check?: () => Promise<unknown>; snapshot?: string } = {}) => {
  const calls: string[] = [];
  const browser = {
    navigate: async (runId: string, url: string) => { calls.push(`navigate ${runId} ${url}`); await options.navigate?.(); },
    check: async (runId: string, input: { target: { css: string; frame: string; first: boolean }; noErrors: boolean }) => {
      calls.push(`check ${runId} ${input.target.frame} ${input.target.css} first=${input.target.first} noErrors=${input.noErrors}`);
      await options.check?.();
    },
    snapshot: async (runId: string) => {
      calls.push(`snapshot ${runId}`);
      return { url: "", title: "", snapshot: options.snapshot ?? "- main:\n  - paragraph: Analyses: 2", truncated: false, errors: ["Network: noise"] };
    },
  } as unknown as RunBrowser;
  const programs = { resolveView: (runId: string, reference: string) => { calls.push(`resolve ${runId} ${reference}`); return options.view ?? view; } } as unknown as ActorProgramsService;
  const fn = createViewSnapshotFunction({ browser, actorPrograms: () => programs, address: () => "http://127.0.0.1:4713" });
  const run = (input: { view: string }) => fn.run({ caller: { runId: "run-1" }, signal: undefined } as never, "call-1", input);
  return { fn, run, calls };
};

test("the view address names the layout, run and element with the host's own address", () => {
  assert.equal(viewAddress("http://127.0.0.1:4713", "run-1", "counter--main"), "http://127.0.0.1:4713/?layout=app&run=run-1&element=counter--main");
  assert.equal(viewAddress("http://127.0.0.1:4713/", "a b", "x"), "http://127.0.0.1:4713/?layout=app&run=a+b&element=x");
});

test("a snapshot opens the resolved view, waits for its frame and reports what it shows", async () => {
  const f = fixture();
  assert.deepEqual(await f.run({ view: "counter/main" }), {
    view: "counter/main",
    snapshot: "- main:\n  - paragraph: Analyses: 2",
    truncated: false,
    errors: ["Network: noise"],
  });
  assert.deepEqual(f.calls, [
    "resolve run-1 counter/main",
    "navigate run-1 http://127.0.0.1:4713/?layout=app&run=run-1&element=counter--main",
    "check run-1 iframe #root > * first=true noErrors=false",
    "snapshot run-1",
  ]);
});

test("a long snapshot is cut and marked as truncated", async () => {
  const f = fixture({ snapshot: "x".repeat(9_000) });
  const result = await f.run({ view: "counter/main" }) as { snapshot: string; truncated: boolean };
  assert.equal(result.snapshot.length, 8_000);
  assert.equal(result.truncated, true);
});

test("a hidden view is an error that names the fix and never reaches the browser", async () => {
  const f = fixture({ view: { ...view, visible: false } });
  await assert.rejects(f.run({ view: "counter/main" }), /counter\/main is hidden\. Show it with actor_view_set_visibility first\./);
  assert.deepEqual(f.calls, ["resolve run-1 counter/main"]);
});

test("a page that cannot be opened names the reachability and sign-in conditions", async () => {
  const f = fixture({ navigate: async () => { throw new Error("Browser navigation failed: HTTP 401 (http://127.0.0.1:4713/)."); } });
  await assert.rejects(f.run({ view: "counter/main" }), /could not be opened: Browser navigation failed: HTTP 401[\s\S]*must not require sign-in/);
});

test("a view that never renders reports the page the browser shows instead", async () => {
  const f = fixture({ check: async () => { throw new Error("locator.waitFor: Timeout 5000ms exceeded."); }, snapshot: "- heading \"Sign in\"" });
  await assert.rejects(f.run({ view: "counter/main" }), /did not render: locator\.waitFor: Timeout[\s\S]*The page shows:\n- heading "Sign in"/);
});

test("the function is available only while the actor programs service exists", () => {
  const programs = {} as ActorProgramsService;
  const browser = {} as RunBrowser;
  const present = createViewSnapshotFunction({ browser, actorPrograms: () => programs, address: () => "http://127.0.0.1:1" });
  const absent = createViewSnapshotFunction({ browser, actorPrograms: () => undefined, address: () => "http://127.0.0.1:1" });
  assert.equal(present.available({} as never, {} as never), true);
  assert.equal(absent.available({} as never, {} as never), false);
  assert.equal(isNativeTool(present), true);
  assert.equal(present.executionMode, "sequential");
});
