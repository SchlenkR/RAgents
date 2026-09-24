import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { WorkspaceOperationError } from "./errors.js";

export interface ResolvedWorkspaceRoot {
  directory: string;
  /** `@name`, bei einer Wurzel unter einem gemeinsamen Alias `@name/<ordner>`. */
  alias?: string;
  environmentVariable?: string;
}

/** Welche Wurzeln die Eingabe einer Operation anspricht: die Aliasse zusätzlicher Wurzeln und ob ein Pfad ohne Alias die Wurzel des Runs nennt. */
export interface AddressedRoots {
  readonly aliases: readonly string[];
  readonly runRoot: boolean;
}

export const NO_ROOTS: AddressedRoots = { aliases: [], runRoot: false };

/** Was ein Aufrufer über eine Eingabe wissen muss, ohne ihre Form zu kennen: die Wurzeln, die sie anspricht, und die Laufzeit, die sie selbst verlangt. */
export interface OperationFootprint {
  readonly roots: AddressedRoots;
  readonly durationMs?: number;
}

/** Der Alias, mit dem ein Pfad beginnt, ist sein erster Abschnitt, wenn der mit @ beginnt. */
export const aliasOf = (location: string): string | undefined =>
  location.startsWith("@") ? location.split("/")[0] : undefined;

/** Die Wurzeln, die Felder einer Eingabe als Pfade nennen, eine Liste mit jedem Eintrag: ein Pfad mit Alias dessen Wurzel, jeder andere die des Runs. */
export const rootsOfFields = (input: unknown, ...keys: readonly string[]): AddressedRoots => {
  const fields: Readonly<Record<string, unknown>> = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const named = keys.flatMap((key) => [fields[key]].flat()).filter((entry): entry is string => typeof entry === "string");
  const aliases = named.map(aliasOf).filter((alias): alias is string => alias !== undefined);
  return { aliases: [...new Set(aliases)], runRoot: named.some((entry) => aliasOf(entry) === undefined) };
};

/** Die Wurzel, die ein Pfad mit Alias nennt, und der Rest darunter; ohne passenden Alias keine. */
export const aliasedRoot = (
  requested: string,
  aliases: Readonly<Record<string, string>>,
): { directory: string; rest: string } | undefined => {
  const found = Object.entries(aliases).find(([alias]) => requested === alias || requested.startsWith(`${alias}/`));
  return found && { directory: found[1], rest: requested.slice(found[0].length + 1) };
};

/** Nennt bei einem gemeinsamen Alias wie `@skills` auch den Ordner darunter, weil erst beide eine Wurzel bestimmen. */
export const unknownAliasError = (requested: string, aliases: Readonly<Record<string, string>>): WorkspaceOperationError => {
  const [first, second] = requested.split("/");
  const known = Object.keys(aliases);
  const named = second !== undefined && known.some((alias) => alias.startsWith(`${first}/`)) ? `${first}/${second}` : first;
  return new WorkspaceOperationError(
    "workspace-alias-unknown",
    `Unbekannter Arbeitsverzeichnis-Alias: ${named} (bekannt: ${known.length > 0 ? known.join(", ") : "keine"})`,
    400,
  );
};

export const expandWorkspaceAlias = (requested: string, aliases: Readonly<Record<string, string>>): string => {
  const found = aliasedRoot(requested, aliases);
  if (found) return path.join(found.directory, found.rest);
  if (requested.startsWith("@")) throw unknownAliasError(requested, aliases);
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

/** Liegt der Pfad in der Wurzel oder ist er sie selbst; auch für eine Laufwerkswurzel wie `/` oder `C:\`. */
export const containsWorkspacePath = (root: string, filename: string): boolean => {
  const relative = path.relative(root, filename);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

export const allowedWorkspacePath = async (filename: string, roots: readonly string[]): Promise<string> => {
  const absolute = await resolvedWorkspacePath(filename);
  const canonicalRoots = await Promise.all(roots.map(resolvedWorkspacePath));
  if (!canonicalRoots.some((root) => containsWorkspacePath(root, absolute))) throw new Error(`Pfad außerhalb des Arbeitsverzeichnisses: ${filename}`);
  return absolute;
};
