import assert from "node:assert/strict";
import test from "node:test";
import { parseRunPanelLocation } from "../src/run-panel/run-panel-location.ts";

const noLooks = { palette: undefined, codeStyle: undefined, corners: undefined, density: undefined };

test("the run panel reads run, host, connection, theme and token from its address and defaults to the browser run panel", () => {
  assert.deepEqual(parseRunPanelLocation(""), { layout: "panel", runId: undefined, host: "browser", connection: undefined, theme: undefined, scheme: undefined, looks: noLooks, access: undefined });
  assert.deepEqual(parseRunPanelLocation("?run=run-a&host=vscode&connection=workshop&theme=dark&access=tok"),
    { layout: "panel", runId: "run-a", host: "vscode", connection: "workshop", theme: "dark", scheme: undefined, looks: noLooks, access: "tok" });
  assert.deepEqual(parseRunPanelLocation("?layout=app&run=run-a&element=board--main"),
    { layout: "app", runId: "run-a", elementId: "board--main", host: "browser", connection: undefined, theme: undefined, scheme: undefined, looks: noLooks, access: undefined });
});

test("the run panel reads the scheme setting and the looks a host keeps in settings", () => {
  const location = parseRunPanelLocation("?host=vscode&theme=light&scheme=auto&palette=midnight&codeStyle=outlined&corners=tight&density=spacious");
  assert.equal(location.scheme, "auto");
  assert.equal(location.theme, "light");
  assert.deepEqual(location.looks, { palette: "midnight", codeStyle: "outlined", corners: "tight", density: "spacious" });
});

test("unknown layouts, hosts and themes and an app page without element are hard errors", () => {
  assert.throws(() => parseRunPanelLocation("?layout=grid"), /panel and app/);
  assert.throws(() => parseRunPanelLocation("?host=electron"), /browser and vscode/);
  assert.throws(() => parseRunPanelLocation("?theme=blue"), /light and dark/);
  assert.throws(() => parseRunPanelLocation("?scheme=system"), /auto, light, and dark/);
  assert.throws(() => parseRunPanelLocation("?layout=app&run=run-a"), /run and element/);
});
