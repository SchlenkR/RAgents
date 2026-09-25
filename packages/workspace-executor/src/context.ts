import { withGitConfigPairs, type GitConfigPairs } from "./git-config-environment.js";
import type { ProcessSandbox } from "./process-sandbox.js";
import { RUN_MARKER_ENV } from "./run-marker.js";
import { inheritedProcessEnvironment, safeProcessEnvironment } from "./safe-environment.js";
import type { SessionIdent } from "./session-ident.js";
import type { ResolvedWorkspaceRoot } from "./paths.js";

/** Was ein Executor über einen Run weiß: seine Ordner, seine Umgebung und seine Kennung. */
export interface WorkspaceProcessContext {
  runId: string;
  cwd: string;
  root: string;
  home: string;
  /** Wohin ein Sprachserver Protokolle und Zwischenstände legen darf; nie das Home eines Entwicklers. */
  logDirectory: string;
  /** Die Wurzel des Hosts auf dieser Maschine, aus der ein Adapter seinen Sprachserver auflöst; ohne Host bleibt sie offen. */
  hostRoot: string | undefined;
  env: NodeJS.ProcessEnv;
  uid?: number;
  gid?: number;
  additionalRoots?: readonly string[];
  readOnlyRoots?: readonly string[];
  workspaceAliases?: Readonly<Record<string, string>>;
  pathVariables?: Readonly<Record<string, string>>;
  runOperation?: <T>(operation: () => Promise<T>) => Promise<T>;
  /** Die Prozess-Sandbox dieses Runs; fehlt sie, starten Prozesse ohne. */
  sandbox?: ProcessSandbox;
  /** Die Bash, mit der das Werkzeug bash startet; unter Windows Pflicht, sonst gilt ohne Angabe die des Systems. */
  bash?: string;
}

export interface SandboxHomeEnvironment {
  home: string;
  nugetPackages?: string;
}

/** Woraus die Umgebung eines Prozesses entsteht: "safe" nimmt nur die sichere Auswahl (Server), "inherited" alles außer Editor-Variablen und Bash-Startdateien (eigener Rechner). */
export type BaseEnvironment = "safe" | "inherited";

export interface SandboxEnvironmentOptions {
  /** Ohne Angabe "safe": wer nichts wählt, gibt nur die sichere Auswahl weiter. */
  base?: BaseEnvironment;
  home: SandboxHomeEnvironment;
  ident?: { name: string };
  pathVariables?: Readonly<Record<string, string>>;
  additions?: Readonly<Record<string, string>>;
}

/** Die Git-Regeln, die in jeder Sandbox gelten, gleich auf welchem Rechner sie läuft. */
export const SANDBOX_GIT_CONFIG: GitConfigPairs = [
  ["branch.autoSetupMerge", "false"],
  ["core.hooksPath", "/dev/null"],
  ["core.sharedRepository", "0"],
];

const onlyStrings = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

/** Was der Server je Run zur Umgebung beiträgt: Run-Marker, Git-Regeln und die Zusätze seines Arbeitsbereichs. */
export const sandboxRunEnvironment = (runId: string, workspace: {
  gitConfig?: GitConfigPairs;
  extraEnv?: NodeJS.ProcessEnv;
  gitEnv?: NodeJS.ProcessEnv;
} = {}): Record<string, string> => onlyStrings({
  ...withGitConfigPairs({ ...workspace.extraEnv }, [...SANDBOX_GIT_CONFIG, ...(workspace.gitConfig ?? [])]),
  GIT_OPTIONAL_LOCKS: "0",
  CI: "true",
  [RUN_MARKER_ENV]: runId,
  ...workspace.gitEnv,
});

/** Ohne eigenes Konto läuft der Prozess unter dem Benutzer dieser Maschine und trägt dessen Namen. */
const accountEnvironment = (source: NodeJS.ProcessEnv, ident: { name: string } | undefined): Record<string, string> =>
  ident ? { USER: ident.name, LOGNAME: ident.name } : onlyStrings({ USER: source.USER, LOGNAME: source.LOGNAME });

/** Die Umgebung eines Sandbox-Prozesses: die gewählte Grundlage dieser Maschine plus die Beiträge des Runs. */
export const sandboxEnvironment = (
  source: NodeJS.ProcessEnv,
  { base = "safe", home, ident, pathVariables, additions }: SandboxEnvironmentOptions,
): NodeJS.ProcessEnv => ({
  ...(base === "inherited" ? inheritedProcessEnvironment(source) : safeProcessEnvironment(source)),
  HOME: home.home,
  USERPROFILE: home.home,
  ...accountEnvironment(source, ident),
  ...(home.nugetPackages ? { NUGET_PACKAGES: home.nugetPackages } : {}),
  ...pathVariables,
  ...additions,
});

export interface WorkspaceContextOptions {
  runId: string;
  cwd: string;
  root: string;
  home: SandboxHomeEnvironment;
  logDirectory: string;
  hostRoot: string | undefined;
  ident?: SessionIdent;
  additionalRoots?: readonly ResolvedWorkspaceRoot[];
  readOnlyRoots?: readonly ResolvedWorkspaceRoot[];
  additions?: Readonly<Record<string, string>>;
  runOperation?: <T>(operation: () => Promise<T>) => Promise<T>;
  sandbox?: ProcessSandbox;
  source?: NodeJS.ProcessEnv;
  baseEnvironment?: BaseEnvironment;
  bash?: string;
}

const namedEntries = (
  roots: readonly ResolvedWorkspaceRoot[],
  pick: (root: ResolvedWorkspaceRoot) => string | undefined,
): Record<string, string> =>
  Object.fromEntries(roots.flatMap((root) => {
    const name = pick(root);
    return name ? [[name, root.directory]] : [];
  }));

/** Ein Alias nennt genau einen Ordner und liegt nicht unter einem anderen, sonst wäre offen, welche Wurzel ein Pfad meint. */
const assertDistinctAliases = (roots: readonly ResolvedWorkspaceRoot[]): void => {
  const aliases = roots.flatMap((root) => root.alias === undefined ? [] : [root.alias]);
  const clash = aliases.find((alias, index) => aliases.some((other, position) =>
    position !== index && (other === alias || other.startsWith(`${alias}/`))));
  if (clash !== undefined) throw new Error(`Der Arbeitsverzeichnis-Alias ${clash} nennt mehr als eine Wurzel`);
};

/** Baut den Kontext eines Runs aus den Ordnern dieser Maschine; jeder Executor ruft dieselbe Funktion. */
export const workspaceProcessContext = (options: WorkspaceContextOptions): WorkspaceProcessContext => {
  const additionalRoots = options.additionalRoots ?? [];
  const readOnlyRoots = options.readOnlyRoots ?? [];
  const all = [...additionalRoots, ...readOnlyRoots];
  assertDistinctAliases(all);
  const pathVariables = namedEntries(all, (root) => root.environmentVariable);
  return {
    runId: options.runId,
    cwd: options.cwd,
    root: options.root,
    home: options.home.home,
    logDirectory: options.logDirectory,
    hostRoot: options.hostRoot,
    env: sandboxEnvironment(options.source ?? process.env, {
      ...(options.baseEnvironment === undefined ? {} : { base: options.baseEnvironment }),
      home: options.home,
      ...(options.ident ? { ident: options.ident } : {}),
      pathVariables,
      ...(options.additions ? { additions: options.additions } : {}),
    }),
    ...(options.ident === undefined ? {} : { uid: options.ident.uid, gid: options.ident.gid }),
    additionalRoots: additionalRoots.map((root) => root.directory),
    readOnlyRoots: readOnlyRoots.map((root) => root.directory),
    workspaceAliases: namedEntries(all, (root) => root.alias),
    pathVariables,
    ...(options.runOperation === undefined ? {} : { runOperation: options.runOperation }),
    ...(options.sandbox === undefined ? {} : { sandbox: options.sandbox }),
    ...(options.bash === undefined ? {} : { bash: options.bash }),
  };
};
