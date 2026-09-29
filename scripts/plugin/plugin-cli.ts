import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlugins, watchPlugins, type PluginBuildOutcome } from "../../apps/server/src/plugin-build/build.ts";
import { callerDirectory } from "../../apps/server/src/profile-target.ts";

export const DEFAULT_OUT = "dist/plugins";

export const usage = (): string => `Usage: ragents plugin build <folder...> [--out <folder>] [--watch] [--no-typecheck]

Builds every plugin source folder with ragents-plugin.json into a bundle under <out>/<id>,
default ./${DEFAULT_OUT}. A bundle may take only the host API from the host and only their
declared exports from other plugins; any other location, a file access relative to its own
location (import.meta.url, __dirname, createRequire), a binary file (.node) and every type
error abort the build with the cause. --watch rebuilds on every change in the folder and does
not check types, the editor does that. Exit code 0 if all plugins are built, otherwise 1.`;

export interface PluginCommand {
  readonly folders: readonly string[];
  readonly out: string;
  readonly watch: boolean;
  readonly typecheck: boolean;
}

export const parsePluginArguments = (argv: readonly string[], caller = callerDirectory()): PluginCommand => {
  const [command, ...rest] = argv;
  if (command !== "build") throw new Error(command ? `Unknown command: plugin ${command}\n\n${usage()}` : usage());
  const folders: string[] = [];
  const switches = new Set<string>();
  let out: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]!;
    if (argument === "--out") {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--out needs a folder.");
      out = value;
      index += 1;
    } else if (argument === "--watch" || argument === "--no-typecheck") {
      switches.add(argument);
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown argument: ${argument}\n\n${usage()}`);
    } else {
      folders.push(path.resolve(caller, argument));
    }
  }
  if (folders.length === 0) throw new Error(`plugin build needs at least one plugin folder.\n\n${usage()}`);
  return {
    folders,
    out: path.resolve(caller, out ?? DEFAULT_OUT),
    watch: switches.has("--watch"),
    typecheck: !switches.has("--no-typecheck") && !switches.has("--watch"),
  };
};

const shown = (folder: string, caller: string): string => {
  const relative = path.relative(caller, folder);
  return relative.startsWith("..") ? folder : relative || ".";
};

export const outcomeLines = (outcome: PluginBuildOutcome, caller = callerDirectory()): readonly string[] =>
  outcome.kind === "built"
    ? [`built: ${outcome.id} -> ${shown(outcome.bundle, caller)} (${outcome.milliseconds} ms${outcome.manifest.uses.length > 0 ? `, uses ${outcome.manifest.uses.join(", ")}` : ""})`]
    : [`failed: ${outcome.id} (${shown(outcome.source, caller)})`, ...outcome.problems.map((problem) => `  ${problem.replaceAll("\n", "\n  ")}`)];

export const printOutcome = (outcome: PluginBuildOutcome): void => {
  const lines = outcomeLines(outcome).join("\n");
  if (outcome.kind === "built") console.log(lines);
  else console.error(lines);
};

export const untilStopped = (): Promise<void> => new Promise((resolve) => {
  process.once("SIGINT", () => resolve());
  process.once("SIGTERM", () => resolve());
});

export const main = async (argv: readonly string[]): Promise<number> => {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "help") {
    console.log(usage());
    return argv.length === 0 ? 1 : 0;
  }
  const command = parsePluginArguments(argv);
  if (command.watch) {
    const watching = await watchPlugins(command.folders, { out: command.out }, printOutcome);
    console.log(`watching ${command.folders.length} plugin folders; Ctrl+C stops`);
    await untilStopped();
    await watching.stop();
    return 0;
  }
  const outcomes = await buildPlugins(command.folders, { out: command.out, typecheck: command.typecheck });
  for (const outcome of outcomes) printOutcome(outcome);
  return outcomes.every((outcome) => outcome.kind === "built") ? 0 : 1;
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
