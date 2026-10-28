import path from "node:path";
import { WorkspaceOperationError } from "./errors.js";
import { resolvedWorkspacePath } from "./paths.js";
import { PROCESS_RESOURCE_PATHS } from "./access-rule.js";

export interface WorkspaceGrant {
  readonly path: string;
  readonly access: "read" | "write";
}

export interface WorkspaceGrantPolicy {
  readonly homeDirectories?: readonly string[];
  readonly dataDirectory?: string;
  readonly protectedPaths?: readonly string[];
}

const secretLocations = [
  ".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".config/gh", ".config/gcloud",
  ".netrc", ".npmrc", ".pypirc", ".git-credentials", "Library/Keychains",
  ".profile", ".bashrc", ".bash_profile", ".bash_login", ".bash_logout", ".zshenv", ".zprofile",
  ".zshrc", ".zlogin", ".zlogout", ".cshrc", ".tcshrc", ".login", ".logout", ".config/fish",
  ".config/zsh", ".config/powershell", ".config/nushell",
];

const windowsStartupLocations = ["Documents/PowerShell", "Documents/WindowsPowerShell"];

const pathKind = (value: string): typeof path.posix | typeof path.win32 =>
  /^[a-z]:[\\/]/i.test(value) || /^[\\/]{2}[^\\/]/.test(value) ? path.win32 : path.posix;

const normalized = (value: string): string => {
  const kind = pathKind(value);
  const result = kind.normalize(value).replace(/[\\/]+$/, "") || "/";
  return kind === path.win32 ? result.replaceAll("\\", "/").toLowerCase() : result;
};

const includes = (root: string, candidate: string): boolean => {
  const parent = normalized(root);
  const child = normalized(candidate);
  return parent === child || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
};

const overlaps = (left: string, right: string): boolean => includes(left, right) || includes(right, left);

const genericHome = (filename: string): string | undefined => {
  const canonical = normalized(filename);
  const found = /^(\/(?:home|Users|export\/home|(?:private\/)?var\/home|System\/Volumes\/Data\/(?:Users|(?:private\/)?var\/home))\/[^/]+)(?:\/|$)/i.exec(canonical)
    ?? /^((?:[a-z]:|\/\/[^/]+\/[^/]+)\/(?:users|documents and settings)\/[^/]+)(?:\/|$)/i.exec(canonical)
    ?? /^(\/(?:root|(?:private\/)?var\/root|System\/Volumes\/Data\/(?:private\/)?var\/root))(?:\/|$)/i.exec(canonical);
  return found?.[1];
};

const tooBroad = (): WorkspaceOperationError => new WorkspaceOperationError(
  "workspace-grant-too-broad", "This path cannot receive a narrow grant; full access is required.", 403,
);

export const assertNarrowWorkspaceGrant = (filename: string, policy: WorkspaceGrantPolicy = {}): void => {
  const kind = pathKind(filename);
  if (!filename || /[\0\r\n*?[\]]/.test(filename) || !kind.isAbsolute(filename) || /^[\\/]{2}[?.][\\/]/.test(filename)) throw tooBroad();
  const canonical = normalized(filename);
  if (canonical === normalized(kind.parse(filename).root)) throw tooBroad();
  if (kind === path.posix && PROCESS_RESOURCE_PATHS.some((directory) => overlaps(filename, directory))) throw tooBroad();
  if (filename.startsWith("//")) assertNarrowWorkspaceGrant(path.posix.normalize(filename), policy);
  const containers = kind === path.win32
    ? [`${kind.parse(filename).root}Users`, `${kind.parse(filename).root}Documents and Settings`]
    : ["/home", "/Users", "/export/home", "/var/home", "/private/var/home", "/var/root", "/private/var/root", "/root",
      "/System/Volumes/Data/Users", "/System/Volumes/Data/var/home", "/System/Volumes/Data/private/var/home", "/System/Volumes/Data/private/var/root"];
  if (containers.some((directory) => includes(filename.toLowerCase(), directory.toLowerCase()))) throw tooBroad();
  const home = genericHome(filename);
  const homes = [...policy.homeDirectories ?? [], ...home ? [home] : []];
  if (homes.some((directory) => includes(filename, directory))) throw tooBroad();
  const secrets = [...secretLocations, ...kind === path.win32 ? windowsStartupLocations : []];
  if (homes.some((directory) => secrets.some((secret) => overlaps(filename.toLowerCase(), `${directory}/${secret}`.toLowerCase())))) throw tooBroad();
  if ([...policy.dataDirectory ? [policy.dataDirectory] : [], ...policy.protectedPaths ?? []].some((directory) => overlaps(filename, directory))) throw tooBroad();
};

export const validateWorkspaceGrants = async (
  grants: readonly WorkspaceGrant[], policy: WorkspaceGrantPolicy = {},
): Promise<readonly WorkspaceGrant[]> => {
  if (grants.length === 0) return grants;
  const localPolicy: WorkspaceGrantPolicy = {
    homeDirectories: await Promise.all((policy.homeDirectories ?? []).map(resolvedWorkspacePath)),
    ...(policy.dataDirectory ? { dataDirectory: await resolvedWorkspacePath(policy.dataDirectory) } : {}),
    protectedPaths: await Promise.all((policy.protectedPaths ?? []).map(resolvedWorkspacePath)),
  };
  return Promise.all(grants.map(async (grant) => {
    if (grant.access !== "read" && grant.access !== "write") throw tooBroad();
    assertNarrowWorkspaceGrant(grant.path, policy);
    const canonical = await resolvedWorkspacePath(grant.path);
    if (normalized(canonical) !== normalized(grant.path)) throw new WorkspaceOperationError(
      "workspace-grant-path-changed", "The granted path now resolves elsewhere; request access again.", 403,
    );
    assertNarrowWorkspaceGrant(canonical, localPolicy);
    return { path: canonical, access: grant.access };
  }));
};
