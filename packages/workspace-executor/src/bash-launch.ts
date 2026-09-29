import { accessSync, constants, existsSync, statSync } from "node:fs";
import path from "node:path";
import { getShellConfig } from "@ragents/agent";

/** A command of the bash tool as it starts: program, arguments and environment. */
export interface BashLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

/** What the executor passes to the bash tool: bash itself and rg; without a value the system's one applies. */
export interface BashPrograms {
  readonly bash: string | undefined;
  readonly rg: string | undefined;
}

/** On Windows RAgents does not search for a bash; the executor names the bundled one. */
const missingWindowsBash = (): Error => new Error(
  "On Windows the bash tool only works with the bash that RAgents bundles, and none is named for this executor. "
  + "The VS Code extension bundles it in its Windows build (win32-x64, win32-arm64) under dist/bash/<platform>/usr/bin/bash.exe "
  + "and passes it on to the workspace and the local host; a host or workspace without the extension needs RAGENTS_BASH with the path of this bash.exe.",
);

const missingRipgrep = (rg: string): Error =>
  new Error(`The rg of this executor is missing: ${rg}. It belongs to the extension (dist/rg/<platform>) or is set in RAGENTS_RG.`);

const pathModule = (platform: NodeJS.Platform): path.PlatformPath => platform === "win32" ? path.win32 : path.posix;

/** The names of the PATH variables; on Windows every spelling counts (`Path`). */
const pathNames = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): readonly string[] =>
  platform === "win32" ? Object.keys(env).filter((name) => name.toUpperCase() === "PATH") : ["PATH"];

const currentPath = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined =>
  pathNames(env, platform).map((name) => env[name]).find((value) => value !== undefined && value !== "");

/** The folders at the front of PATH, as one PATH variable; on Windows MSYSTEM belongs to a Git Bash login and is dropped. */
const withPathFront = (env: NodeJS.ProcessEnv, directories: readonly string[], platform: NodeJS.Platform): NodeJS.ProcessEnv => {
  if (directories.length === 0) return env;
  const names = pathNames(env, platform);
  const current = currentPath(env, platform);
  const kept = Object.entries(env).filter(([name]) => !names.includes(name) && (platform !== "win32" || name !== "MSYSTEM"));
  const delimiter = pathModule(platform).delimiter;
  return { ...Object.fromEntries(kept), PATH: [...directories, ...(current ? [current] : [])].join(delimiter) };
};

const isExecutableFile = (file: string, platform: NodeJS.Platform): boolean => {
  try {
    if (platform !== "win32") accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

/** Whether the bash of this executor finds rg: the named one, otherwise one in PATH; a named one that is missing is an error. */
export const ripgrepAvailable = (rg: string | undefined, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): boolean => {
  if (rg !== undefined) {
    if (!existsSync(rg)) throw missingRipgrep(rg);
    return true;
  }
  const file = platform === "win32" ? "rg.exe" : "rg";
  return (currentPath(env, platform) ?? "").split(pathModule(platform).delimiter).filter(Boolean)
    .some((directory) => isExecutableFile(path.join(directory, file), platform));
};

/** How a command starts in the bash of this executor: the directory of rg at the front of PATH, on Windows followed by the usr/bin of the bash so that find.exe and sort.exe from System32 do not win. */
export const bashLaunch = (
  { bash, rg }: BashPrograms,
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): BashLaunch => {
  if (platform === "win32" && bash === undefined) throw missingWindowsBash();
  if (bash !== undefined && !existsSync(bash)) {
    throw new Error(`The bash of this executor is missing: ${bash}. On Windows it belongs to the extension (dist/bash/<platform>) or is set in RAGENTS_BASH.`);
  }
  if (rg !== undefined && !existsSync(rg)) throw missingRipgrep(rg);
  const shell = getShellConfig(bash, platform);
  if (!/bash(\.exe)?$/i.test(shell.shell)) throw new Error(`${shell.shell} is not a bash; the tool is called bash and the prompt describes bash`);
  const paths = pathModule(platform);
  const front = [
    ...(rg === undefined ? [] : [paths.dirname(rg)]),
    ...(platform === "win32" ? [paths.dirname(shell.shell)] : []),
  ];
  return {
    command: shell.shell,
    args: [...shell.args, command],
    env: withPathFront(env, front, platform),
  };
};
