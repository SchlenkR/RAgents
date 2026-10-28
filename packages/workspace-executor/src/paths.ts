import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceProcessContext } from "./context.js";
import { WorkspaceOperationError } from "./errors.js";
import { validateWorkspaceGrants } from "./grants.js";
import { ruleAllowsPath } from "./access-rule.js";

export interface ResolvedWorkspaceRoot {
  directory: string;
  /** `@name`, for a root under a shared alias `@name/<folder>`. */
  alias?: string;
  environmentVariable?: string;
}

/** Which roots the input of an operation addresses: the aliases of additional roots and whether a path without an alias names the root of the run. */
export interface AddressedRoots {
  readonly aliases: readonly string[];
  readonly runRoot: boolean;
}

export const NO_ROOTS: AddressedRoots = { aliases: [], runRoot: false };

/** What a caller must know about an input without knowing its shape: the roots it addresses and the running time it requires itself. */
export interface OperationFootprint {
  readonly roots: AddressedRoots;
  readonly durationMs?: number;
}

/** The alias a path starts with is its first segment, if that starts with @. */
export const aliasOf = (location: string): string | undefined =>
  location.startsWith("@") ? location.split("/")[0] : undefined;

/** The roots that fields of an input name as paths, a list with every entry: a path with an alias its root, every other one the root of the run. */
export const rootsOfFields = (input: unknown, ...keys: readonly string[]): AddressedRoots => {
  const fields: Readonly<Record<string, unknown>> = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const named = keys.flatMap((key) => [fields[key]].flat()).filter((entry): entry is string => typeof entry === "string");
  const aliases = named.map(aliasOf).filter((alias): alias is string => alias !== undefined);
  return { aliases: [...new Set(aliases)], runRoot: named.some((entry) => aliasOf(entry) === undefined) };
};

/** The root that a path with an alias names, and the rest below it; without a matching alias none. */
export const aliasedRoot = (
  requested: string,
  aliases: Readonly<Record<string, string>>,
): { directory: string; rest: string } | undefined => {
  const found = Object.entries(aliases).find(([alias]) => requested === alias || requested.startsWith(`${alias}/`));
  return found && { directory: found[1], rest: requested.slice(found[0].length + 1) };
};

/** For a shared alias like `@skills` also names the folder below it, because only both together determine a root. */
export const unknownAliasError = (requested: string, aliases: Readonly<Record<string, string>>): WorkspaceOperationError => {
  const [first, second] = requested.split("/");
  const known = Object.keys(aliases);
  const named = second !== undefined && known.some((alias) => alias.startsWith(`${first}/`)) ? `${first}/${second}` : first;
  return new WorkspaceOperationError(
    "workspace-alias-unknown",
    `Unknown working directory alias: ${named} (known: ${known.length > 0 ? known.join(", ") : "none"})`,
    400,
  );
};

export const expandWorkspaceAlias = (requested: string, aliases: Readonly<Record<string, string>>): string => {
  const found = aliasedRoot(requested, aliases);
  if (found) return path.join(found.directory, found.rest);
  if (requested.startsWith("@")) throw unknownAliasError(requested, aliases);
  return requested;
};

export const expandPathVariables = (value: string, variables: Readonly<Record<string, string>>): string => {
  for (const [name, root] of Object.entries(variables)) {
    for (const prefix of [`$${name}`, `\${${name}}`]) {
      const relative = value.startsWith("./") ? value.slice(2) : value;
      if (relative === prefix || relative.startsWith(prefix + "/")) return path.join(root, relative.slice(prefix.length));
    }
  }
  return value;
};

export const resolvedWorkspacePath = async (filename: string): Promise<string> => {
  let candidate = path.resolve(filename);
  const rest: string[] = [];
  for (;;) {
    try { return path.join(await realpath(candidate), ...rest); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const info = await lstat(candidate).catch(() => undefined);
      if (info?.isSymbolicLink()) throw new Error(`Path outside the working directory: ${filename}`);
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      rest.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
};

/** Whether the path lies in the root or is the root itself; also for a drive root like `/` or `C:\`. */
export const containsWorkspacePath = (root: string, filename: string): boolean => {
  const relative = path.relative(root, filename);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

export const allowedWorkspacePath = async (filename: string, roots: readonly string[]): Promise<string> => {
  const absolute = await resolvedWorkspacePath(filename);
  const canonicalRoots = await Promise.all(roots.map(resolvedWorkspacePath));
  if (!canonicalRoots.some((root) => containsWorkspacePath(root, absolute))) throw new Error(`Path outside the working directory: ${filename}`);
  return absolute;
};

export const workspacePathRoots = async (context: WorkspaceProcessContext, filename: string, writing = false): Promise<readonly string[]> => {
  if (context.access?.level === "full") return [path.parse(await resolvedWorkspacePath(filename)).root];
  if (context.accessRule) {
    await validateWorkspaceGrants(context.access?.grants ?? [], context.grantPolicy);
    const namespaces = context.accessRule.processNamespaces ?? [];
    const outsideNamespace = (candidate: string): boolean => namespaces.some((root) => containsWorkspacePath(root, path.resolve(candidate)))
      || /^(?:\\\\\.\\|\\\\\?\\(?:GLOBALROOT|pipe)\\)/i.test(candidate);
    const assertHostPath = (candidate: string): void => {
      if (outsideNamespace(candidate)) throw new WorkspaceOperationError("workspace-process-namespace", "Use a command to inspect the run's process and device namespace; file tools cannot read the host's process resources.", 403);
    };
    assertHostPath(filename);
    const canonical = await resolvedWorkspacePath(filename);
    assertHostPath(canonical);
    const readOnly = writing ? await Promise.all((context.readOnlyRoots ?? []).map(resolvedWorkspacePath)) : [];
    return !readOnly.some((root) => containsWorkspacePath(root, canonical))
      && ruleAllowsPath(context.accessRule, canonical, writing ? "write" : "read") ? [canonical] : [];
  }
  const grants = await validateWorkspaceGrants(context.access?.grants ?? [], context.grantPolicy);
  const canonical = grants.length > 0 ? await resolvedWorkspacePath(filename) : filename;
  const grantRoots = await Promise.all(grants.filter((grant) => !writing || grant.access === "write").map(async (grant) => {
    const info = await stat(grant.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
      throw error;
    });
    return info?.isDirectory() || path.relative(grant.path, canonical) === "" ? [grant.path] : [];
  }));
  return [context.root, ...context.additionalRoots ?? [], ...writing ? [] : context.readOnlyRoots ?? [],
    ...grantRoots.flat()];
};
