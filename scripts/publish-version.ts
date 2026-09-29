import { readFileSync, writeFileSync } from "node:fs";

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/;

const places = (version: string): readonly number[] => version.split("-")[0]!.split(".").map(Number);

/** Compares two versions place by place; a prerelease tag does not count. */
export const compareVersions = (left: string, right: string): number => {
  const [first, second] = [places(left), places(right)];
  return [0, 1, 2].map((index) => (first[index] ?? 0) - (second[index] ?? 0)).find((difference) => difference !== 0) ?? 0;
};

export interface NextVersion {
  readonly version: string;
  readonly latest?: string;
}

/** The version of the next publish: one step above the highest published one, otherwise the higher one from package.json. */
export const nextVersion = (current: string, published: readonly string[]): NextVersion => {
  if (!versionPattern.test(current)) throw new Error(`The version ${JSON.stringify(current)} in package.json is not a version`);
  const latest = published.filter((version) => versionPattern.test(version)).sort(compareVersions).at(-1);
  if (latest === undefined) return { version: current };
  const [major, minor, patch] = places(latest);
  const raised = `${major ?? 0}.${minor ?? 0}.${(patch ?? 0) + 1}`;
  return { version: compareVersions(current, raised) > 0 ? current : raised, latest };
};

/** npm package and extension carry the same version: one step above everything already taken locally or published. */
export const releaseVersion = (current: readonly string[], published: readonly string[]): NextVersion =>
  nextVersion([...current].sort(compareVersions).at(-1)!, published);

/** The line every publish says first: which version it becomes and what was last out. */
export const versionLine = (next: NextVersion): string =>
  `== Version ${next.version}, ${next.latest === undefined ? "nothing published yet" : `last published ${next.latest}`}`;

export const readVersion = (file: string): string => {
  const version = (JSON.parse(readFileSync(file, "utf8")) as { version?: unknown }).version;
  if (typeof version !== "string") throw new Error(`${file}: version is missing and is the version`);
  return version;
};

/** Only the line with version is written; the rest of the file stays character for character. */
export const withVersion = (text: string, version: string): string => {
  const written = text.replace(/^(\s*"version"\s*:\s*)"[^"]*"/m, `$1${JSON.stringify(version)}`);
  if ((JSON.parse(written) as { version?: unknown }).version !== version) throw new Error("The line with version cannot be found in package.json");
  return written;
};

export const writeVersion = (file: string, version: string): void => writeFileSync(file, withVersion(readFileSync(file, "utf8"), version));

/** The same rule for the host package version in the extension: only that one line changes. */
export const withHostPackageVersion = (text: string, version: string): string => {
  const written = text.replace(/^(\s*"packageVersion"\s*:\s*)"[^"]*"/m, `$1${JSON.stringify(version)}`);
  const found = (JSON.parse(written) as { ragents?: { packageVersion?: unknown } }).ragents?.packageVersion;
  if (found !== version) throw new Error("The line with ragents.packageVersion cannot be found in package.json");
  return written;
};

export const writeHostPackageVersion = (file: string, version: string): void =>
  writeFileSync(file, withHostPackageVersion(readFileSync(file, "utf8"), version));
