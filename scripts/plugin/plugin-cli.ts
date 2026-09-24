import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlugins, watchPlugins, type PluginBuildOutcome } from "../../apps/server/src/plugin-build/build.ts";
import { callerDirectory } from "../../apps/server/src/profile-target.ts";

export const DEFAULT_OUT = "dist/plugins";

export const usage = (): string => `Verwendung: ragents plugin build <ordner...> [--out <ordner>] [--watch] [--no-typecheck]

Baut jeden Plugin-Quellordner mit ragents-plugin.json zu einem Bundle unter <out>/<kennung>,
Vorgabe ./${DEFAULT_OUT}. Ein Bundle darf vom Host nur die Host-API beziehen und von anderen
Plugins nur deren deklarierte Exporte; jede andere Stelle, ein Dateizugriff über den eigenen Ort
(import.meta.url, __dirname, createRequire), eine Binärdatei (.node) und jeder Typfehler brechen
den Bau mit Ursache ab. --watch baut bei jeder Änderung im Ordner neu und prüft keine Typen, das
tut der Editor. Exit-Code 0, wenn alle Plugins gebaut sind, sonst 1.`;

export interface PluginCommand {
  readonly folders: readonly string[];
  readonly out: string;
  readonly watch: boolean;
  readonly typecheck: boolean;
}

export const parsePluginArguments = (argv: readonly string[], caller = callerDirectory()): PluginCommand => {
  const [command, ...rest] = argv;
  if (command !== "build") throw new Error(command ? `Unbekannter Befehl: plugin ${command}\n\n${usage()}` : usage());
  const folders: string[] = [];
  const switches = new Set<string>();
  let out: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]!;
    if (argument === "--out") {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--out braucht einen Ordner.");
      out = value;
      index += 1;
    } else if (argument === "--watch" || argument === "--no-typecheck") {
      switches.add(argument);
    } else if (argument.startsWith("--")) {
      throw new Error(`Unbekanntes Argument: ${argument}\n\n${usage()}`);
    } else {
      folders.push(path.resolve(caller, argument));
    }
  }
  if (folders.length === 0) throw new Error(`plugin build braucht mindestens einen Plugin-Ordner.\n\n${usage()}`);
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
    ? [`gebaut: ${outcome.id} -> ${shown(outcome.bundle, caller)} (${outcome.milliseconds} ms${outcome.manifest.uses.length > 0 ? `, nutzt ${outcome.manifest.uses.join(", ")}` : ""})`]
    : [`fehlgeschlagen: ${outcome.id} (${shown(outcome.source, caller)})`, ...outcome.problems.map((problem) => `  ${problem.replaceAll("\n", "\n  ")}`)];

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
    console.log(`beobachte ${command.folders.length} Plugin-Ordner; Strg+C beendet`);
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
