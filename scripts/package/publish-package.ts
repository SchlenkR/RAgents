import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, nextVersion, readVersion, versionLine, writeHostPackageVersion, writeVersion } from "../publish-version.ts";
import { buildPackage, PACKAGE_FOLDER, PACKAGE_NAME } from "./build-package.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const usage = `Verwendung: pnpm publish:package [--dry-run]
Baut das Paket ${PACKAGE_NAME} und veröffentlicht es auf npm. Der Token kommt aus der
Umgebungsvariable npm_key. --dry-run reicht npm den Probelauf durch und veröffentlicht nichts.
Die Fassung steht in der package.json der Wurzel; das Skript zählt vor dem Bauen die letzte Stelle
über die zuletzt veröffentlichte hoch, im Probelauf nur in der Ausgabe.`;

const REGISTRY_TOKEN_KEY = "npm_config_//registry.npmjs.org/:_authToken";

export interface NpmResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type NpmRunner = (args: readonly string[], options: { cwd: string; token?: string }) => NpmResult;

/** Der Token geht nur als Konfiguration in die Umgebung des Kindprozesses, nie auf die Kommandozeile. */
export const publishEnvironment = (token: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv =>
  ({ ...base, [REGISTRY_TOKEN_KEY]: token });

/** Alles, was von npm kommt, geht durch diese Maske, damit der Token auch in einer Fehlermeldung nicht auftaucht. */
export const redacting = (token: string) => (text: string): string => token ? text.split(token).join("<npm_key>") : text;

/** Eine Fehlermeldung ist eine Zeile; die Ausgabe von npm wandert deshalb auf eine. */
export const oneLine = (text: string): string => text.split("\n").map((line) => line.trim()).filter(Boolean).join("; ");

const runNpm: NpmRunner = (args, options) => {
  const result = spawnSync("npm", [...args], {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.token ? publishEnvironment(options.token) : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw new Error(`npm ${args[0]} konnte nicht gestartet werden: ${result.error.message}`);
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

/** Die Fassungen, die schon auf npm liegen; ein dort unbekanntes Paket ist die leere Liste, kein Fehler. */
export const publishedVersions = (name: string, npm: NpmRunner): readonly string[] => {
  const result = npm(["view", name, "versions", "--json"], { cwd: repositoryRoot });
  if (result.status !== 0) {
    if (/E404|404 Not Found/.test(`${result.stdout}\n${result.stderr}`)) return [];
    throw new Error(`npm view ${name} versions endete mit Code ${result.status}: ${oneLine(result.stderr)}`);
  }
  const parsed = JSON.parse(result.stdout.trim() || "[]") as string | readonly string[];
  return typeof parsed === "string" ? [parsed] : parsed;
};

/** Die höchste Fassung, die auf npm liegt; ein dort unbekanntes Paket hat keine. */
export const latestPublishedVersion = (npm: NpmRunner = runNpm, name = PACKAGE_NAME): string | undefined =>
  [...publishedVersions(name, npm)].sort(compareVersions).at(-1);

export interface PublishPlan {
  readonly name: string;
  readonly version: string;
  readonly hostVersion: string;
}

/** Was vor einem Publish stimmen muss: das gebaute Manifest und eine Fassung, die es auf npm noch nicht gibt. */
export const publishPlan = (manifest: Record<string, unknown>, published: readonly string[], version: string): PublishPlan => {
  const { name } = manifest as { name?: unknown };
  const access = (manifest.publishConfig as { access?: unknown } | undefined)?.access;
  const hostVersion = (manifest.ragents as { hostVersion?: unknown } | undefined)?.hostVersion;
  if (name !== PACKAGE_NAME) throw new Error(`Das gebaute Paket heißt ${String(name)}, veröffentlicht wird ${PACKAGE_NAME}`);
  if (access !== "public") throw new Error(`${PACKAGE_NAME} hat einen Scope und braucht publishConfig.access "public", nicht ${JSON.stringify(access)}`);
  if (!/^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/.test(version)) {
    throw new Error(`Die Fassung ${JSON.stringify(version)} ist keine Fassung; sie steht als version in der package.json der Wurzel`);
  }
  if (typeof hostVersion !== "string" || !/^[0-9a-f]{40}$/.test(hostVersion)) {
    throw new Error("Dem Paket fehlt ragents.hostVersion als vollständiger Git-Commit; gebaut wird nur aus einem Checkout");
  }
  if (published.includes(version)) {
    throw new Error(`${PACKAGE_NAME}@${version} liegt schon auf npm (dort: ${published.join(", ")}); `
      + "erhöhe version in der package.json der Wurzel und baue neu");
  }
  return { name: PACKAGE_NAME, version, hostVersion };
};

export interface PublishOptions {
  readonly directory: string;
  readonly version: string;
  readonly token: string;
  readonly dryRun: boolean;
  readonly npm: NpmRunner;
  readonly log: (line: string) => void;
}

/** npm meldet eine fehlende Organisation als 404; ohne den Hinweis sucht man den Fehler beim Paket. */
const scopeAdvice = (output: string): string => /Scope not found/i.test(output)
  ? ` Die Organisation ${PACKAGE_NAME.split("/")[0]} existiert auf npm nicht oder der Token darf sie nicht: `
    + "auf npmjs.com anlegen bzw. den Token für den Scope freigeben."
  : "";

/** Veröffentlicht den gebauten Ordner; der Exit 0 von npm publish ist die Bestätigung. */
export const publishDirectory = (options: PublishOptions): void => {
  const hide = redacting(options.token);
  const published = options.npm(["publish", "--access", "public", ...options.dryRun ? ["--dry-run"] : []], { cwd: options.directory, token: options.token });
  const output = `${published.stdout}${published.stderr}`;
  for (const line of output.split("\n")) if (line.trim()) options.log(hide(line));
  if (published.status !== 0) throw new Error(`npm publish endete mit Code ${published.status}.${scopeAdvice(output)}`);
  if (options.dryRun) {
    options.log("== Probelauf: nichts veröffentlicht");
    return;
  }
  options.log(`== Veröffentlicht: ${PACKAGE_NAME}@${options.version}`);
};

const main = async (): Promise<void> => {
  const dryRun = process.argv.includes("--dry-run");
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--dry-run");
  if (unknown.length) throw new Error(`Unbekanntes Argument: ${unknown.join(" ")}\n${usage}`);
  const token = process.env.npm_key;
  if (!token) throw new Error(`npm_key fehlt: der npm-Token mit Schreibrecht auf ${PACKAGE_NAME}.\n${usage}`);
  const manifestFile = path.join(repositoryRoot, "package.json");
  const published = publishedVersions(PACKAGE_NAME, runNpm);
  const next = nextVersion(readVersion(manifestFile), published);
  console.log(versionLine(next));
  const extensionManifestFile = path.join(repositoryRoot, "apps", "vscode", "package.json");
  if (!dryRun) {
    writeVersion(manifestFile, next.version);
    writeHostPackageVersion(extensionManifestFile, next.version);
  }
  const built = await buildPackage(path.join(repositoryRoot, "dist", PACKAGE_FOLDER));
  const plan = publishPlan(built.manifest, published, next.version);
  console.log(`== ${plan.name}@${plan.version} aus Host ${plan.hostVersion.slice(0, 12)}, ${built.fileCount} Dateien, ${(built.byteSize / 1024 / 1024).toFixed(1)} MB`);
  publishDirectory({ directory: built.directory, version: plan.version, token, dryRun, npm: runNpm, log: (line) => console.log(line) });
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
