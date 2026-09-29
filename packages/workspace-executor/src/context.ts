import { withGitConfigPairs, type GitConfigPairs } from "./git-config-environment.js";
import type { ProcessSandbox } from "./process-sandbox.js";
import { RUN_MARKER_ENV } from "./run-marker.js";
import { inheritedProcessEnvironment, safeProcessEnvironment } from "./safe-environment.js";
import type { SessionIdent } from "./session-ident.js";
import type { ResolvedWorkspaceRoot } from "./paths.js";

/** What an executor knows about a run: its folders, its environment and its id. */
export interface WorkspaceProcessContext {
  runId: string;
  cwd: string;
  root: string;
  home: string;
  /** Where a language server may put logs and intermediate state; never the home of a developer. */
  logDirectory: string;
  /** The root of the host on this machine from which an adapter resolves its language server; without a host it stays open. */
  hostRoot: string | undefined;
  env: NodeJS.ProcessEnv;
  uid?: number;
  gid?: number;
  additionalRoots?: readonly string[];
  readOnlyRoots?: readonly string[];
  workspaceAliases?: Readonly<Record<string, string>>;
  pathVariables?: Readonly<Record<string, string>>;
  runOperation?: <T>(operation: () => Promise<T>) => Promise<T>;
  /** The process sandbox of this run; if it is missing, processes start without one. */
  sandbox?: ProcessSandbox;
  /** The bash the bash tool starts with; required on Windows, otherwise the system's one applies without a value. */
  bash?: string;
  /** The rg whose folder the bash tool has at the front of PATH; without a value one in PATH applies, if there is one. */
  rg?: string;
}

export interface SandboxHomeEnvironment {
  home: string;
  nugetPackages?: string;
}

/** What the environment of a process is built from: "safe" takes only the safe selection (server), "inherited" everything except editor variables and bash startup files (own machine). */
export type BaseEnvironment = "safe" | "inherited";

export interface SandboxEnvironmentOptions {
  /** Defaults to "safe": whoever chooses nothing passes on only the safe selection. */
  base?: BaseEnvironment;
  home: SandboxHomeEnvironment;
  ident?: { name: string };
  pathVariables?: Readonly<Record<string, string>>;
  additions?: Readonly<Record<string, string>>;
}

/** The Git rules that apply in every sandbox, no matter which machine it runs on. */
export const SANDBOX_GIT_CONFIG: GitConfigPairs = [
  ["branch.autoSetupMerge", "false"],
  ["core.hooksPath", "/dev/null"],
  ["core.sharedRepository", "0"],
];

const onlyStrings = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

/** What the server contributes to the environment per run: run marker, Git rules and the additions of its workspace. */
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

/** Without its own account the process runs as the user of this machine and carries that user's name. */
const accountEnvironment = (source: NodeJS.ProcessEnv, ident: { name: string } | undefined): Record<string, string> =>
  ident ? { USER: ident.name, LOGNAME: ident.name } : onlyStrings({ USER: source.USER, LOGNAME: source.LOGNAME });

/** The environment of a sandbox process: the chosen base of this machine plus the contributions of the run. */
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
  rg?: string;
}

const namedEntries = (
  roots: readonly ResolvedWorkspaceRoot[],
  pick: (root: ResolvedWorkspaceRoot) => string | undefined,
): Record<string, string> =>
  Object.fromEntries(roots.flatMap((root) => {
    const name = pick(root);
    return name ? [[name, root.directory]] : [];
  }));

/** An alias names exactly one folder and does not lie under another, otherwise it would be open which root a path means. */
const assertDistinctAliases = (roots: readonly ResolvedWorkspaceRoot[]): void => {
  const aliases = roots.flatMap((root) => root.alias === undefined ? [] : [root.alias]);
  const clash = aliases.find((alias, index) => aliases.some((other, position) =>
    position !== index && (other === alias || other.startsWith(`${alias}/`))));
  if (clash !== undefined) throw new Error(`The working directory alias ${clash} names more than one root`);
};

/** Builds the context of a run from the folders of this machine; every executor calls the same function. */
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
    ...(options.rg === undefined ? {} : { rg: options.rg }),
  };
};
