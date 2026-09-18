import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

const hostDirectory = fileURLToPath(new URL("../../../apps/web/src/", import.meta.url));
const clientUiDirectory = fileURLToPath(new URL("../client-ui/", import.meta.url));
export const frameStylesheet = path.join(hostDirectory, "ui/frame.css");

export type TailwindSource = string | { base: string; pattern: string };

/** Compiles the frame stylesheet against the host components plus the given sources; a plain string scans a whole directory. */
export const buildTailwind = async (sources: readonly TailwindSource[], entry = frameStylesheet): Promise<string> => {
  const css = await readFile(entry, "utf8");
  const compiler = await compile(css, { base: path.dirname(entry), onDependency: () => {} });
  const scanner = new Scanner({ sources: [
    ...compiler.sources,
    ...[hostDirectory, clientUiDirectory, ...sources].map((source) => typeof source === "string" ? { base: source, pattern: "**/*", negated: false } : { ...source, negated: false }),
  ] });
  return compiler.build(scanner.scan());
};
