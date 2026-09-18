import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export function defaultDataDirectory(profile: string, home = homedir()): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(profile)) throw new Error("PRODUCT_PROFILE muss ein einfacher Profilname sein.");
  return path.resolve(home, ".local/share/ragents", profile);
}

async function physicalDirectory(directory: string): Promise<string> {
  try {
    return await realpath(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const entry = await lstat(directory).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return undefined;
      throw cause;
    });
    if (entry) throw error;
    const parent = path.dirname(directory);
    if (parent === directory) throw error;
    return path.join(await physicalDirectory(parent), path.basename(directory));
  }
}

export async function assertDataDirectoryIsolated(directory: string): Promise<void> {
  const physical = await physicalDirectory(path.resolve(directory));
  for (let current = physical; ; current = path.dirname(current)) {
    for (const marker of [".git", "pnpm-workspace.yaml", "package.json"]) {
      const filename = path.join(current, marker);
      const entry = await lstat(filename).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (entry) throw new Error(`DATA_DIR liegt innerhalb eines Projekts (${filename}). Wähle einen externen Datenordner, zum Beispiel ~/.local/share/ragents/<profil>.`);
    }
    if (path.dirname(current) === current) return;
  }
}
