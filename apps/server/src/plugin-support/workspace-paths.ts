import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export interface ResolvedWorkspaceRoot {
  directory: string;
  alias?: string;
  environmentVariable?: string;
}

export const expandWorkspaceAlias = (requested: string, aliases: Readonly<Record<string, string>>): string => {
  for (const [alias, directory] of Object.entries(aliases)) {
    if (requested === alias || requested.startsWith(`${alias}/`)) return path.join(directory, requested.slice(alias.length));
  }
  if (requested.startsWith("@")) throw new Error(`Unbekannter Arbeitsverzeichnis-Alias: ${requested.split("/")[0]}`);
  return requested;
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
      if (info?.isSymbolicLink()) throw new Error(`Pfad außerhalb des Arbeitsverzeichnisses: ${filename}`);
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      rest.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
};

export const containsWorkspacePath = (root: string, filename: string): boolean => filename === root || filename.startsWith(`${root}${path.sep}`);

export const allowedWorkspacePath = async (filename: string, roots: readonly string[]): Promise<string> => {
  const absolute = await resolvedWorkspacePath(filename);
  const canonicalRoots = await Promise.all(roots.map(resolvedWorkspacePath));
  if (!canonicalRoots.some((root) => containsWorkspacePath(root, absolute))) throw new Error(`Pfad außerhalb des Arbeitsverzeichnisses: ${filename}`);
  return absolute;
};
