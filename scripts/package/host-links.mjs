import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync } from "node:fs";
import path from "node:path";

const isFile = (file) => statSync(file, { throwIfNoEntry: false })?.isFile() === true;

const workspaceFolders = (root) => [
  ...["apps", "packages"].flatMap((group) => {
    const folder = path.join(root, group);
    if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) return [];
    return readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(folder, entry.name));
  }),
  path.join(root, "plugins"),
].filter((folder) => isFile(path.join(folder, "package.json")));

const nameOf = (folder) => {
  const file = path.join(folder, "package.json");
  const name = JSON.parse(readFileSync(file, "utf8")).name;
  if (typeof name !== "string" || !name) throw new Error(`${file} names no package name`);
  return name;
};

/** Creates in the package @schlenkr/ragents the links that pnpm creates in the checkout; in the checkout it does nothing. */
export const ensureHostLinks = (root) => {
  const manifest = path.join(root, "package.json");
  if (!isFile(manifest) || JSON.parse(readFileSync(manifest, "utf8")).ragents?.hostVersion === undefined) return [];
  const created = [];
  for (const folder of workspaceFolders(root)) {
    const link = path.join(root, "node_modules", nameOf(folder));
    const existing = lstatSync(link, { throwIfNoEntry: false });
    if (existing) {
      if (realpathSync(link) !== realpathSync(folder)) throw new Error(`${link} does not point to ${folder}; the package is damaged`);
      continue;
    }
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(folder, link, process.platform === "win32" ? "junction" : "dir");
    created.push(path.relative(path.join(root, "node_modules"), link));
  }
  return created;
};
