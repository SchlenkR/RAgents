import { accessSync, constants, existsSync, statSync } from "node:fs";
import path from "node:path";
import { getShellConfig } from "@ragents/agent";

/** Ein Befehl des Werkzeugs bash, so wie er startet: Programm, Argumente und Umgebung. */
export interface BashLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

/** Was der Executor dem Werkzeug bash mitgibt: die Bash selbst und rg; ohne Angabe gilt jeweils das des Systems. */
export interface BashPrograms {
  readonly bash: string | undefined;
  readonly rg: string | undefined;
}

/** Unter Windows sucht RAgents keine Bash; der Executor nennt die mitgebrachte. */
const missingWindowsBash = (): Error => new Error(
  "Unter Windows arbeitet das Werkzeug bash nur mit der Bash, die RAgents mitbringt, und für diesen Executor ist keine genannt. "
  + "Die VS-Code-Erweiterung bringt sie in ihrer Windows-Fassung (win32-x64, win32-arm64) unter dist/bash/<plattform>/usr/bin/bash.exe mit "
  + "und reicht sie an Arbeitsplatz und lokalen Host weiter; ein Host oder Arbeitsplatz ohne Erweiterung braucht RAGENTS_BASH mit dem Pfad dieser bash.exe.",
);

const missingRipgrep = (rg: string): Error =>
  new Error(`Das rg dieses Executors fehlt: ${rg}. Es gehört zur Erweiterung (dist/rg/<plattform>) oder steht in RAGENTS_RG.`);

const pathModule = (platform: NodeJS.Platform): path.PlatformPath => platform === "win32" ? path.win32 : path.posix;

/** Die Namen der PATH-Variablen; unter Windows zählt jede Schreibweise (`Path`). */
const pathNames = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): readonly string[] =>
  platform === "win32" ? Object.keys(env).filter((name) => name.toUpperCase() === "PATH") : ["PATH"];

const currentPath = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined =>
  pathNames(env, platform).map((name) => env[name]).find((value) => value !== undefined && value !== "");

/** Die Ordner vorn im PATH, als eine Variable PATH; MSYSTEM gehört unter Windows einer Git-Bash-Anmeldung und fällt weg. */
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

/** Ob die Bash dieses Executors rg findet: das genannte, sonst eines im PATH; ein genanntes, das fehlt, ist ein Fehler. */
export const ripgrepAvailable = (rg: string | undefined, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): boolean => {
  if (rg !== undefined) {
    if (!existsSync(rg)) throw missingRipgrep(rg);
    return true;
  }
  const file = platform === "win32" ? "rg.exe" : "rg";
  return (currentPath(env, platform) ?? "").split(pathModule(platform).delimiter).filter(Boolean)
    .some((directory) => isExecutableFile(path.join(directory, file), platform));
};

/** Wie ein Befehl in der Bash dieses Executors startet: das Verzeichnis von rg vorn im PATH, unter Windows dahinter das usr/bin der Bash, damit find.exe und sort.exe aus System32 nicht gewinnen. */
export const bashLaunch = (
  { bash, rg }: BashPrograms,
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): BashLaunch => {
  if (platform === "win32" && bash === undefined) throw missingWindowsBash();
  if (bash !== undefined && !existsSync(bash)) {
    throw new Error(`Die Bash dieses Executors fehlt: ${bash}. Unter Windows gehört sie zur Erweiterung (dist/bash/<plattform>) oder steht in RAGENTS_BASH.`);
  }
  if (rg !== undefined && !existsSync(rg)) throw missingRipgrep(rg);
  const shell = getShellConfig(bash, platform);
  if (!/bash(\.exe)?$/i.test(shell.shell)) throw new Error(`${shell.shell} ist keine Bash; das Werkzeug heißt bash und der Prompt beschreibt bash`);
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
