import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

type PackageManager = "npm" | "pnpm";

interface InvocationOptions {
  readonly platform?: NodeJS.Platform;
  readonly node?: string;
  readonly npmExecpath?: string;
  readonly locations?: (name: string) => readonly string[];
  readonly exists?: (file: string) => boolean;
}

const windowsLocations = (name: string): readonly string[] => {
  const result = spawnSync("where.exe", [name], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name} is missing from PATH`);
  return result.stdout.trim().split(/\r?\n/);
};

export const packageManagerInvocation = (name: PackageManager, args: readonly string[], options: InvocationOptions = {}): { command: string; args: readonly string[] } => {
  if ((options.platform ?? process.platform) !== "win32") return { command: name, args };
  const node = options.node ?? process.execPath;
  const exists = options.exists ?? existsSync;
  const execpath = options.npmExecpath ?? process.env.npm_execpath;
  const isEntry = (file: string): boolean => (name === "npm" ? /^npm(?:-cli)?\.c?js$/i : /^pnpm\.c?js$/i).test(path.win32.basename(file));
  if (execpath && isEntry(execpath) && exists(execpath)) return { command: node, args: [execpath, ...args] };
  const locations = (options.locations ?? windowsLocations)(name);
  for (const location of locations) {
    if (/\.exe$/i.test(location) && exists(location)) return { command: location, args };
    const directory = path.win32.dirname(location);
    const entries = [
      path.win32.join(directory, "node_modules", name, "bin", name === "npm" ? "npm-cli.js" : "pnpm.cjs"),
      path.win32.join(directory, "node_modules", "corepack", "dist", `${name}.js`),
      path.win32.resolve(directory, "../dist", `${name}.js`),
    ];
    const entry = entries.find(exists);
    if (entry) return { command: node, args: [entry, ...args] };
  }
  throw new Error(`Cannot find ${name}'s Node CLI or native executable. Install ${name} through Node, Corepack, or its official installer.`);
};
