import { readFileSync, writeFileSync } from "node:fs";

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/;

const places = (version: string): readonly number[] => version.split("-")[0]!.split(".").map(Number);

/** Vergleicht zwei Fassungen Stelle für Stelle; eine Vorabkennung zählt dabei nicht mit. */
export const compareVersions = (left: string, right: string): number => {
  const [first, second] = [places(left), places(right)];
  return [0, 1, 2].map((index) => (first[index] ?? 0) - (second[index] ?? 0)).find((difference) => difference !== 0) ?? 0;
};

export interface NextVersion {
  readonly version: string;
  readonly latest?: string;
}

/** Die Fassung des nächsten Publish: eine Stelle über der höchsten veröffentlichten, sonst die höhere aus der package.json. */
export const nextVersion = (current: string, published: readonly string[]): NextVersion => {
  if (!versionPattern.test(current)) throw new Error(`Die Fassung ${JSON.stringify(current)} der package.json ist keine Fassung`);
  const latest = published.filter((version) => versionPattern.test(version)).sort(compareVersions).at(-1);
  if (latest === undefined) return { version: current };
  const [major, minor, patch] = places(latest);
  const raised = `${major ?? 0}.${minor ?? 0}.${(patch ?? 0) + 1}`;
  return { version: compareVersions(current, raised) > 0 ? current : raised, latest };
};

/** Die Zeile, die jeder Publish zuerst sagt: welche Fassung es wird und was zuletzt draußen war. */
export const versionLine = (next: NextVersion): string =>
  `== Fassung ${next.version}, ${next.latest === undefined ? "noch nichts veröffentlicht" : `zuletzt veröffentlicht ${next.latest}`}`;

export const readVersion = (file: string): string => {
  const version = (JSON.parse(readFileSync(file, "utf8")) as { version?: unknown }).version;
  if (typeof version !== "string") throw new Error(`${file}: version fehlt und ist die Fassung`);
  return version;
};

/** Geschrieben wird nur die Zeile mit version; der Rest der Datei bleibt Zeichen für Zeichen stehen. */
export const withVersion = (text: string, version: string): string => {
  const written = text.replace(/^(\s*"version"\s*:\s*)"[^"]*"/m, `$1${JSON.stringify(version)}`);
  if ((JSON.parse(written) as { version?: unknown }).version !== version) throw new Error("In der package.json ist die Zeile mit version nicht zu finden");
  return written;
};

export const writeVersion = (file: string, version: string): void => writeFileSync(file, withVersion(readFileSync(file, "utf8"), version));

/** Dieselbe Regel für die Fassung des Host-Pakets in der Erweiterung: nur die eine Zeile wandert. */
export const withHostPackageVersion = (text: string, version: string): string => {
  const written = text.replace(/^(\s*"packageVersion"\s*:\s*)"[^"]*"/m, `$1${JSON.stringify(version)}`);
  const found = (JSON.parse(written) as { ragents?: { packageVersion?: unknown } }).ragents?.packageVersion;
  if (found !== version) throw new Error("In der package.json ist die Zeile mit ragents.packageVersion nicht zu finden");
  return written;
};

export const writeHostPackageVersion = (file: string, version: string): void =>
  writeFileSync(file, withHostPackageVersion(readFileSync(file, "utf8"), version));
