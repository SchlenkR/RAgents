import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceProcessContext } from "../context.js";
import { runManagedProcess } from "../managed-process.js";
import { containsWorkspacePath } from "../paths.js";
import { sandboxedLaunch } from "../process-sandbox.js";

const GIT_TIMEOUT_MS = 30 * 1000;
const DIRECTORY_DEPTH = 6;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "bin", "obj"]);

interface GitResult {
  code: number | null;
  output: string;
}

interface FoundSolution {
  path: string;
  root: string;
}

export const runGit = async (
  context: WorkspaceProcessContext,
  directory: string,
  args: readonly string[],
): Promise<GitResult> => {
  const chunks: Buffer[] = [];
  const launch = await sandboxedLaunch(context, { command: "git", args });
  const result = await runManagedProcess({
    command: launch.command,
    args: [...launch.args],
    cwd: directory,
    env: context.env,
    uid: context.uid,
    gid: context.gid,
    label: `git ${args[0]}`,
    timeoutMs: GIT_TIMEOUT_MS,
    onStdout: (chunk) => { chunks.push(chunk); },
  });
  return { code: result.code, output: Buffer.concat(chunks).toString("utf8") };
};

const skipped = (name: string): boolean => SKIPPED_DIRECTORIES.has(name.toLowerCase());

const matches = (relative: string, extensions: readonly string[]): boolean =>
  extensions.includes(path.extname(relative).toLowerCase())
  && !relative.split("/").slice(0, -1).some(skipped);

const gitSolutions = async (context: WorkspaceProcessContext, extensions: readonly string[]): Promise<string[] | undefined> => {
  if ((await runGit(context, context.root, ["rev-parse", "--is-inside-work-tree"])).code !== 0) return undefined;
  const listed = await runGit(context, context.root, [
    "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--",
    ...extensions.map((extension) => `:(icase)*${extension}`),
  ]);
  if (listed.code !== 0) throw new Error(`git ls-files ist mit Code ${listed.code} gescheitert`);
  return listed.output.split("\0").filter(Boolean);
};

const directorySolutions = async (root: string, extensions: readonly string[], relative = "", depth = 0): Promise<string[]> => {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return depth < DIRECTORY_DEPTH && !entry.name.startsWith(".") && !skipped(entry.name)
        ? directorySolutions(root, extensions, child, depth + 1)
        : [];
    }
    return entry.isFile() ? [child] : [];
  }));
  return nested.flat();
};

/** Ohne Git-Arbeitsverzeichnis durchsucht es den Ordner selbst, sechs Ebenen tief und ohne versteckte Ordner. */
export const workspaceSolutions = async (
  context: WorkspaceProcessContext,
  extensions: readonly string[],
): Promise<{ source: "git" | "directory"; solutions: FoundSolution[] }> => {
  const tracked = await gitSolutions(context, extensions);
  const candidates = [...new Set(tracked ?? await directorySolutions(context.root, extensions))]
    .filter((relative) => matches(relative, extensions))
    .sort((left, right) => left.localeCompare(right, "de"));
  const workspaceRoot = await realpath(context.root);
  const found = await Promise.all(candidates.map(async (relative): Promise<FoundSolution | undefined> => {
    const absolute = path.join(context.root, relative);
    if (!await stat(absolute).then((info) => info.isFile(), () => false)) return undefined;
    const root = await realpath(absolute);
    return containsWorkspacePath(workspaceRoot, root) ? { path: relative, root } : undefined;
  }));
  return { source: tracked ? "git" : "directory", solutions: found.filter((entry) => entry !== undefined) };
};
