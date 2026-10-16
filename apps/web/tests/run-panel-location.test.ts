import assert from "node:assert/strict";
import test from "node:test";
import { pageIn, parseRunPanelLocation, withPage } from "../src/run-panel/run-panel-location.ts";

const noLooks = { palette: undefined, codeStyle: undefined, corners: undefined, density: undefined };

test("the run panel reads run, host, connection, theme and token from its address and defaults to the browser run panel", () => {
  assert.deepEqual(parseRunPanelLocation(""), { layout: "panel", runId: undefined, pageId: undefined, host: "browser", connection: undefined, theme: undefined, scheme: undefined, looks: noLooks, access: undefined });
  assert.deepEqual(parseRunPanelLocation("?run=run-a&host=vscode&connection=workshop&theme=dark&access=tok"),
    { layout: "panel", runId: "run-a", pageId: undefined, host: "vscode", connection: "workshop", theme: "dark", scheme: undefined, looks: noLooks, access: "tok" });
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

test("run panel and app frames carry each table spacing, and an old address leaves the saved value alone", () => {
  for (const layout of ["", "layout=app&run=run-a&element=board--main&"]) {
    const base = parseRunPanelLocation(`?${layout}host=vscode`);
    assert.equal(base.looks.density, undefined, "an old frame URL keeps the saved table spacing");
    for (const density of ["compact", "comfortable", "spacious"] as const) {
      assert.deepEqual(parseRunPanelLocation(`?${layout}host=vscode&density=${density}`), { ...base, looks: { ...base.looks, density } });
    }
  }
});

test("the address names a plugin page next to the run and keeps every other part when the page changes", () => {
  const location = parseRunPanelLocation("?page=reports");
  assert.ok(location.layout === "panel");
  assert.equal(location.pageId, "reports");
  assert.equal(pageIn("?run=run-a&page=%20reports%20"), "reports");
  assert.equal(pageIn("?run=run-a&page="), undefined);
  assert.equal(pageIn(""), undefined);
  const address = "http://localhost:4710/?host=browser&run=run-a";
  const opened = withPage(address, "acme.reports");
  assert.equal(opened, "http://localhost:4710/?host=browser&run=run-a&page=acme.reports");
  assert.equal(pageIn(new URL(opened).search), "acme.reports");
  assert.equal(withPage(opened, "other page"), "http://localhost:4710/?host=browser&run=run-a&page=other+page");
  assert.equal(pageIn(new URL(withPage(opened, "other page")).search), "other page");
  assert.equal(withPage(opened, undefined), address);
  assert.equal(withPage(address, undefined), address);
});
