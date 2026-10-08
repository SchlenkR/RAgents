import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const scale = new Set(["0", "0.5", "1", "2", "3", "4", "6", "8", "px"]);
const spacing = /(?<![\w-])((?:[a-z0-9@[\]\-_/:&>*()=.]+:)*)(gap(?:-[xy])?|p[xytblrse]?|m[xytblrse]?|space-[xy])-(\[[^\]\s]+\]|\d+(?:\.\d+)?|px)(?![\w.[-])/g;
const controls = /\/ui\/(button|toggle|toggle-group|input|textarea|select|combobox|checkbox|switch|radio-group|badge|tabs|tooltip|dropdown-menu|search-input)\.tsx$/;
const pending = /(FlowDiagramRenderer|RunHeader|RunPanelApp)\.tsx$/;

const sources = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
  const path = join(directory, name);
  if (name === "node_modules" || name === "tests" || name === "dist") return [];
  return statSync(path).isDirectory() ? sources(path) : path.endsWith(".tsx") ? [path] : [];
});

const offScale = (path: string) => {
  const text = readFileSync(path, "utf8");
  return [...text.matchAll(spacing)].filter((match) => {
    const [, , property, value] = match;
    if (scale.has(value!)) return false;
    if (/^(pl|pr|ml|mr|ps|pe|ms|me)$/.test(property!) && parseFloat(value!) >= 8) return false;
    if (value!.startsWith("[")) {
      if (/var\(|clamp\(|%|ch\]|em\]|vh|vw/.test(value!)) return false;
      if (/^(pl|pr|ml|mr|ps|pe|ms|me)$/.test(property!) && parseFloat(value!.slice(1)) >= 20) return false;
    }
    return true;
  }).map((match) => `${relative(root, path)}:${text.slice(0, match.index).split("\n").length} ${match[0]}`);
};

test("layout spacing uses only the scale: hair 0.5, tight 1, related 2, group 3, gutter 4, section 6, block 8", () => {
  const files = [...sources(join(root, "apps/web/src")), ...readdirSync(join(root, "plugins")).flatMap((plugin) => {
    const web = join(root, "plugins", plugin, "web");
    try { return statSync(web).isDirectory() ? sources(web) : []; } catch { return []; }
  })].filter((path) => !controls.test(path) && !pending.test(path));
  assert.ok(files.length > 100, "the scan covers the host and every plugin web part");
  assert.deepEqual(files.flatMap(offScale), []);
});
