import { strict as assert } from "node:assert";
import { test } from "node:test";
import { initializeAppearance } from "../src/appearance";
import { bindHostAppearance } from "../src/run-panel/host-appearance";
import type { RunPanelHost } from "../src/run-panel/host";
import type { HostRunPanelMessage, RunPanelHostMessage } from "../src/run-panel/host-contract";
import { parseRunPanelLocation } from "../src/run-panel/run-panel-location";
import { createEditorSystemScheme, createThemeStore } from "../src/theme";

function fixture(search: string) {
  const storage = new Map<string, string>();
  const dataset: Record<string, string> = {};
  const browser = Object.assign(new EventTarget(), {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } },
    document: { documentElement: { dataset } },
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
  }) as unknown as Window;
  const listeners = new Set<(message: HostRunPanelMessage) => void>();
  const sent: RunPanelHostMessage[] = [];
  const host = {
    kind: "vscode",
    onCommand: (listener: (message: HostRunPanelMessage) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    notify: (message: RunPanelHostMessage) => { sent.push(message); },
  } as unknown as RunPanelHost;
  const location = parseRunPanelLocation(search);
  const editor = createEditorSystemScheme(location.theme ?? "dark");
  const theme = createThemeStore(browser, editor);
  const appearance = initializeAppearance(browser);
  const unbind = bindHostAppearance({ host, location, theme, editor });
  const command = (message: HostRunPanelMessage) => { for (const listener of [...listeners]) listener(message); };
  return { appearance, theme, dataset, sent, command, unbind, dispose: () => { unbind(); theme.dispose(); appearance.dispose(); } };
}

test("the settings of the host reach the panel through its address without reporting them back", () => {
  const page = fixture("?host=vscode&theme=light&scheme=auto&palette=midnight&codeStyle=outlined&corners=tight&density=spacious");
  assert.equal(page.theme.getSnapshot().preference, "system");
  assert.equal(page.theme.getSnapshot().appearance, "light");
  assert.deepEqual(page.dataset, { theme: "light", palette: "midnight", codeStyle: "outlined", corners: "tight", density: "spacious" });
  assert.deepEqual(page.sent, []);
  page.dispose();
});

test("an appearance message from the host switches scheme and looks, and auto follows the editor", () => {
  const page = fixture("?host=vscode&theme=dark&scheme=auto");
  page.command({ type: "appearance", scheme: "auto", theme: "light", palette: "black", codeStyle: "tint", corners: "round", density: "comfortable" });
  assert.equal(page.theme.getSnapshot().preference, "system");
  assert.equal(page.theme.getSnapshot().appearance, "light");
  assert.equal(page.dataset.palette, "black");
  page.command({ type: "appearance", scheme: "dark", theme: "light", palette: "black", codeStyle: "tint", corners: "round", density: "comfortable" });
  assert.deepEqual([page.theme.getSnapshot().preference, page.theme.getSnapshot().appearance], ["dark", "dark"]);
  assert.deepEqual(page.sent, [], "what the host sends is never echoed back");
  assert.throws(() => page.command({ type: "appearance", scheme: "auto", theme: "dark", palette: "sepia", codeStyle: "tint", corners: "round", density: "comfortable" }), /Unknown palette "sepia"/);
  page.dispose();
});

test("a change the user makes in the panel is reported to the host as the changed setting only", () => {
  const page = fixture("?host=vscode&theme=dark&scheme=dark&palette=graphite");
  page.appearance.palette.set("black");
  page.appearance.density.set("spacious");
  page.theme.setPreference("system");
  assert.deepEqual(page.sent, [
    { type: "appearanceChanged", palette: "black" },
    { type: "appearanceChanged", density: "spacious" },
    { type: "appearanceChanged", scheme: "auto" },
  ]);
  page.appearance.palette.set("black");
  assert.equal(page.sent.length, 3, "choosing what is already active reports nothing");
  page.dispose();
});

test("the theme message of an older extension applies only until the host sends its settings", () => {
  const legacy = fixture("?host=vscode&theme=dark");
  legacy.command({ type: "theme", theme: "light" });
  assert.equal(legacy.theme.getSnapshot().appearance, "light");
  legacy.dispose();
  const managed = fixture("?host=vscode&theme=dark&scheme=dark");
  managed.command({ type: "theme", theme: "light" });
  assert.equal(managed.theme.getSnapshot().appearance, "dark");
  managed.dispose();
});

test("unbinding stops the reports", () => {
  const page = fixture("?host=vscode&scheme=dark");
  page.unbind();
  page.appearance.palette.set("black");
  assert.deepEqual(page.sent, []);
  page.theme.dispose();
  page.appearance.dispose();
});
