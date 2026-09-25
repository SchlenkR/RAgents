import { existsSync } from "node:fs";
import path from "node:path";
import { getShellConfig } from "@ragents/agent";

/** Ein Befehl des Werkzeugs bash, so wie er startet: Programm, Argumente und Umgebung. */
export interface BashLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

/** Unter Windows sucht RAgents keine Bash; der Executor nennt die mitgebrachte. */
const missingWindowsBash = (): Error => new Error(
  "Unter Windows arbeitet das Werkzeug bash nur mit der Bash, die RAgents mitbringt, und für diesen Executor ist keine genannt. "
  + "Die VS-Code-Erweiterung bringt sie in ihrer Windows-Fassung (win32-x64, win32-arm64) unter dist/bash/<plattform>/usr/bin/bash.exe mit "
  + "und reicht sie an Arbeitsplatz und lokalen Host weiter; ein Host oder Arbeitsplatz ohne Erweiterung braucht RAGENTS_BASH mit dem Pfad dieser bash.exe.",
);

/** Die Windows-Umgebung der Bash: ihr usr/bin vorn im PATH, damit find.exe und sort.exe aus System32 nicht gewinnen; MSYSTEM gehört einer Git-Bash-Anmeldung. */
const windowsBashEnvironment = (env: NodeJS.ProcessEnv, bin: string): NodeJS.ProcessEnv => {
  const pathNames = Object.keys(env).filter((name) => name.toUpperCase() === "PATH");
  const current = pathNames.map((name) => env[name]).find((value) => value !== undefined && value !== "");
  const kept = Object.entries(env).filter(([name]) => !pathNames.includes(name) && name !== "MSYSTEM");
  return { ...Object.fromEntries(kept), PATH: current ? `${bin}${path.win32.delimiter}${current}` : bin };
};

/** Wie ein Befehl in der Bash dieses Executors startet; die Plattform ist für Prüfungen wählbar. */
export const bashLaunch = (
  bash: string | undefined,
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): BashLaunch => {
  if (platform === "win32" && bash === undefined) throw missingWindowsBash();
  if (bash !== undefined && !existsSync(bash)) {
    throw new Error(`Die Bash dieses Executors fehlt: ${bash}. Unter Windows gehört sie zur Erweiterung (dist/bash/<plattform>) oder steht in RAGENTS_BASH.`);
  }
  const shell = getShellConfig(bash, platform);
  if (!/bash(\.exe)?$/i.test(shell.shell)) throw new Error(`${shell.shell} ist keine Bash; das Werkzeug heißt bash und der Prompt beschreibt bash`);
  return {
    command: shell.shell,
    args: [...shell.args, command],
    env: platform === "win32" ? windowsBashEnvironment(env, path.win32.dirname(shell.shell)) : env,
  };
};
