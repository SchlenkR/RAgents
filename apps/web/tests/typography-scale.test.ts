import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const tokens = "apps/web/src/ui/theme.css";
const extensions = /\.(?:[cm]?[jt]sx?|css)$/;
const length = /^(?:length:|[-+\d.]|(?:calc|min|max|clamp)\(|(?:var\()?--(?:text|font|type))/;
const declarations = /(?<![\w-])(?:font-size|line-height|letter-spacing|font)\s*:/g;
const inlineTypography = /["']?\b(?:fontSize|lineHeight|letterSpacing)["']?\s*:\s*|["'](?:font-size|line-height|letter-spacing)["']\s*:|\.style\.(?:fontSize|lineHeight|letterSpacing)\s*=|\.setProperty\(\s*["'](?:font-size|line-height|letter-spacing)["']/g;
const textSize = /(?<![\w-])text-\[([^\]\s]+)\]|(?<![\w-])text-(xs|[2-9]xl)(?![\w-])/g;
const overrides = /(?<![\w-])(?:leading|tracking)-(?:\[[^\]\s]+\]|\([^\)\s]+\)|[\w.-]+)/g;

const sources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  if (["node_modules", "dist", "tests"].includes(entry.name)) return [];
  const path = join(directory, entry.name);
  return entry.isDirectory() ? sources(path) : extensions.test(path) ? [path] : [];
});

function violations(text: string, path: string) {
  const found = [
    ...[...text.matchAll(textSize)].filter((match) => match[2] !== undefined || length.test(match[1]!)),
    ...text.matchAll(overrides),
    ...text.matchAll(inlineTypography),
    ...(path === tokens ? [] : [...text.matchAll(declarations)]),
  ];
  return found.map((match) => `${path}:${text.slice(0, match.index).split("\n").length} ${match[0]}`);
}

test("host and plugin typography use the shared scale", () => {
  const files = [
    ...sources(join(root, "apps/web/src")),
    ...readdirSync(join(root, "plugins")).flatMap((plugin) => {
      const web = join(root, "plugins", plugin, "web");
      return existsSync(web) ? sources(web) : [];
    }),
  ];
  assert.ok(files.length > 100, "the scan covers the host and every plugin web part");
  assert.deepEqual(files.flatMap((path) => violations(readFileSync(path, "utf8"), relative(root, path))), []);
});

test("typography check rejects size and rhythm overrides in variants and inline styles", () => {
  for (const value of [
    "text-[0.8rem]", "[&_small]:text-[12px]", "text-[length:inherit]", "text-[calc(var(--text-sm)*0.95)]",
    "text-xs", "text-2xl", "hover:leading-[1.6]", "leading-normal", "leading-(--control-line-height)",
    "tracking-[0.05em]", "tracking-tight", "fontSize: 14", "lineHeight: 1.5", "letterSpacing: 'normal'",
    "'fontSize': 14", "element.style.fontSize = '14px'", "element.style.setProperty('line-height', '1.5')",
    "font-size: var(--text-base)", "line-height: 1.5", "letter-spacing: normal", "font: 16px sans-serif",
  ]) assert.equal(violations(value, "view.tsx").length, 1, value);
});

test("typography check allows scale utilities, arbitrary colors and computed style reads", () => {
  for (const value of [
    "text-base text-sm text-lg text-xl", "text-[color-mix(in_srgb,var(--warning)_75%,var(--destructive))]",
    "text-[#123456]", "text-[var(--foreground)]", "getComputedStyle(element).fontSize", "const lineHeight = bounds.height;",
  ]) assert.deepEqual(violations(value, "view.tsx"), [], value);
  assert.deepEqual(violations("font-size: var(--text-base); line-height: 1.5; letter-spacing: normal;", tokens), []);
});
