import { readFileSync, writeFileSync } from "node:fs";
import { contrastRules, paletteStylesheet, palettes, paletteTokens, type PaletteMode, type PaletteName } from "./palettes.ts";

const target = new URL("../../apps/web/src/ui/palettes.css", import.meta.url);
const verbose = process.argv.includes("--report");
const stylesheet = paletteStylesheet();

const failures: string[] = [];
for (const name of Object.keys(palettes) as PaletteName[]) {
  for (const mode of ["light", "dark"] as const satisfies readonly PaletteMode[]) {
    if (verbose) console.log(`\n${name} ${mode}`);
    for (const rule of contrastRules(mode, paletteTokens(name, mode))) {
      if (verbose) console.log(`  ${rule.pass ? "ok  " : "FAIL"} ${rule.ratio.toFixed(2).padStart(5)} (>= ${rule.goal})  ${rule.pair}`);
      if (!rule.pass) failures.push(`${name} ${mode}: ${rule.pair} is ${rule.ratio.toFixed(2)}, needs ${rule.goal}`);
    }
  }
}
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== stylesheet) {
    console.error("palettes.css is out of date; run pnpm generate:palettes.");
    process.exit(1);
  }
} else {
  writeFileSync(target, stylesheet);
  console.log(`${target.pathname} written.`);
}
