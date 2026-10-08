import assert from "node:assert/strict";
import test from "node:test";
import { parseRunPanelLocation } from "../src/run-panel/run-panel-location.ts";

test("the run panel reads run, host, connection, theme and token from its address and defaults to the browser run panel", () => {
  assert.deepEqual(parseRunPanelLocation(""), { layout: "panel", runId: undefined, host: "browser", connection: undefined, theme: undefined, access: undefined });
  assert.deepEqual(parseRunPanelLocation("?run=run-a&host=vscode&connection=workshop&theme=dark&access=tok"),
    { layout: "panel", runId: "run-a", host: "vscode", connection: "workshop", theme: "dark", access: "tok" });
  assert.deepEqual(parseRunPanelLocation("?layout=app&run=run-a&element=board--main"),
    { layout: "app", runId: "run-a", elementId: "board--main", host: "browser", connection: undefined, theme: undefined, access: undefined });
});

test("unknown layouts, hosts and themes and an app page without element are hard errors", () => {
  assert.throws(() => parseRunPanelLocation("?layout=grid"), /panel and app/);
  assert.throws(() => parseRunPanelLocation("?host=electron"), /browser and vscode/);
  assert.throws(() => parseRunPanelLocation("?theme=blue"), /light and dark/);
  assert.throws(() => parseRunPanelLocation("?layout=app&run=run-a"), /run and element/);
});

test("run panel and app frames accept each table spacing and reject invalid query values", () => {
  for (const layout of ["", "layout=app&run=run-a&element=board--main&"]) {
    const base = parseRunPanelLocation(`?${layout}host=vscode`);
    assert.equal(Object.hasOwn(base, "density"), false, "an old frame URL keeps the saved table spacing");
    for (const density of ["compact", "comfortable", "spacious"] as const) {
      assert.deepEqual(parseRunPanelLocation(`?${layout}host=vscode&density=${density}`), { ...base, density });
    }
    for (const density of ["", "auto", "Compact", "3"]) {
      assert.throws(() => parseRunPanelLocation(`?${layout}host=vscode&density=${density}`), /Invalid table spacing.*ragents\.density/);
    }
  }
});
