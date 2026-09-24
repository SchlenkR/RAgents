import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPackageVersion } from "../../apps/server/src/host-version.ts";
import { latestPublishedVersion, type NpmRunner } from "../package/publish-package.ts";
import { compareVersions, nextVersion, readVersion, versionLine, writeVersion } from "../publish-version.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const PUBLISHER = "purestate";
export const EXTENSION_NAME = "ragents-vscode";
export const EXTENSION_ID = `${PUBLISHER}.${EXTENSION_NAME}`;
export const VSCE_VERSION = "4.0.0";

const TOKEN_KEY = "AZURE_DEVOPS_VSCE_RAGENTS_PAT";
const extensionRoot = path.join(repositoryRoot, "apps", "vscode");
const manifestFile = path.join(extensionRoot, "package.json");
const outputFolder = path.join(repositoryRoot, "dist");

const usage = `Verwendung: pnpm publish:vscode [--dry-run]
Baut die Erweiterung ${EXTENSION_ID}, packt sie nach dist/ und veröffentlicht sie auf dem Visual
Studio Marketplace. Der Token kommt aus der Umgebungsvariable ${TOKEN_KEY}. --dry-run macht alles
außer dem Publish und zeigt den Inhalt der .vsix. Die Fassung steht in apps/vscode/package.json;
das Skript zählt vor dem Packen die letzte Stelle über die zuletzt veröffentlichte hoch, im
Probelauf nur in der Ausgabe.`;

export interface VsceResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type VsceRunner = (args: readonly string[], options: { cwd: string; token?: string }) => VsceResult;

/** Der Token geht nur als VSCE_PAT in die Umgebung des Kindprozesses, nie auf die Kommandozeile. */
export const publishEnvironment = (token: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv =>
  ({ ...base, VSCE_PAT: token });

/** Alles, was von vsce kommt, geht durch diese Maske, damit der Token auch in einer Fehlermeldung nicht auftaucht. */
export const redacting = (token: string) => (text: string): string => token ? text.split(token).join(`<${TOKEN_KEY}>`) : text;

/** Eine Fehlermeldung ist eine Zeile; die Ausgabe von vsce wandert deshalb auf eine. */
export const oneLine = (text: string): string => text.split("\n").map((line) => line.trim()).filter(Boolean).join("; ");

const runVsce: VsceRunner = (args, options) => {
  const result = spawnSync("pnpm", ["dlx", `@vscode/vsce@${VSCE_VERSION}`, ...args], {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.token ? publishEnvironment(options.token) : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw new Error(`vsce ${args[0]} konnte nicht gestartet werden: ${result.error.message}`);
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

/** Einen Herausgeber, den es nicht gibt, meldet der Marketplace als fehlendes Recht; ohne den Hinweis sucht man den Fehler beim Token. */
export const publisherAdvice = (publisher: string, output: string): string => /Access Denied/i.test(output)
  ? ` Entweder gibt es den Herausgeber ${publisher} im Marketplace noch nicht - dann auf `
    + "https://marketplace.visualstudio.com/manage mit demselben Konto anlegen -, oder der Token hat keinen "
    + "Marketplace-Bereich für alle Organisationen."
  : "";

/** Prüft vor allem anderen, dass der Token für den Herausgeber schreiben darf. */
export const verifyToken = (publisher: string, token: string, vsce: VsceRunner): void => {
  const result = vsce(["verify-pat", publisher], { cwd: repositoryRoot, token });
  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`;
    throw new Error(`vsce verify-pat ${publisher} endete mit Code ${result.status}: `
      + `${redacting(token)(oneLine(output))}.${publisherAdvice(publisher, output)}`);
  }
};

/** Die Fassungen, die schon im Marketplace liegen; eine dort unbekannte Erweiterung ist die leere Liste, kein Fehler. */
export const publishedVersions = (extensionId: string, vsce: VsceRunner): readonly string[] => {
  const result = vsce(["show", extensionId, "--json"], { cwd: repositoryRoot });
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status !== 0) {
    if (/not found/i.test(output)) return [];
    throw new Error(`vsce show ${extensionId} endete mit Code ${result.status}: ${oneLine(result.stderr)}`);
  }
  const text = result.stdout.trim();
  if (!text || text === "undefined") return [];
  const listed = (JSON.parse(text) as { versions?: readonly { version?: unknown }[] }).versions ?? [];
  return [...new Set(listed.map((entry) => entry.version).filter((version): version is string => typeof version === "string"))];
};

/** Die Fassung, die ein Benutzer der Erweiterung von npm bekäme: die zuletzt veröffentlichte, sonst die, die dieser
 * Checkout als nächstes veröffentlicht - nach einem Paket-Publish zählt sie, solange die Registrierung noch nachzieht. */
export const expectedHostPackageVersion = (npm?: NpmRunner): string =>
  [latestPublishedVersion(npm), readPackageVersion(repositoryRoot)].filter((version): version is string => version !== undefined)
    .sort(compareVersions).at(-1)!;

/** Erweiterung und Host-Paket gehören zusammen: ohne Checkout holt die Erweiterung genau diese Fassung von npm. */
export const assertHostPackageVersion = (manifest: Record<string, unknown>, expected: string): void => {
  const version = (manifest.ragents as { packageVersion?: unknown } | undefined)?.packageVersion;
  if (version === expected) return;
  throw new Error(`apps/vscode/package.json nennt unter ragents.packageVersion ${JSON.stringify(version)}, `
    + `das Paket steht auf ${expected}; setze das Feld auf ${expected}`);
};

export interface PublishPlan {
  readonly extensionId: string;
  readonly version: string;
}

/** Was vor einem Publish stimmen muss: ein Manifest, das der Marketplace annimmt, und eine dort unbekannte Fassung. */
export const publishPlan = (manifest: Record<string, unknown>, published: readonly string[], version: string): PublishPlan => {
  const { name, publisher } = manifest as { name?: unknown; publisher?: unknown };
  if (name !== EXTENSION_NAME) throw new Error(`Die Erweiterung heißt ${String(name)}, veröffentlicht wird ${EXTENSION_NAME}`);
  if (publisher !== PUBLISHER) throw new Error(`Der Herausgeber ist ${JSON.stringify(publisher)}, veröffentlicht wird unter ${PUBLISHER}`);
  if (manifest.private) throw new Error("Das Manifest ist private; der Marketplace nimmt nur eine Erweiterung ohne dieses Feld");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Die Fassung ${JSON.stringify(version)} ist keine Fassung; sie steht als version in apps/vscode/package.json`);
  }
  const filled: readonly (readonly [string, boolean])[] = [
    ...(["displayName", "description", "license", "icon"] as const).map((field) => [field, typeof manifest[field] === "string" && Boolean(manifest[field])] as const),
    ["repository", typeof (manifest.repository as { url?: unknown } | undefined)?.url === "string"],
    ["engines.vscode", typeof (manifest.engines as { vscode?: unknown } | undefined)?.vscode === "string"],
    ...(["categories", "keywords"] as const).map((field) => [field, Array.isArray(manifest[field]) && (manifest[field] as unknown[]).length > 0] as const),
  ];
  const missing = filled.filter(([, present]) => !present).map(([field]) => field);
  if (missing.length) throw new Error(`Dem Manifest fehlen Felder für den Marketplace: ${missing.join(", ")}`);
  if (published.includes(version)) {
    throw new Error(`${EXTENSION_ID}@${version} liegt schon im Marketplace (dort: ${published.join(", ")}); `
      + "erhöhe version in apps/vscode/package.json von Hand");
  }
  return { extensionId: EXTENSION_ID, version };
};

export interface PublishOptions {
  readonly vsix: string;
  readonly version: string;
  readonly token: string;
  readonly vsce: VsceRunner;
  readonly log: (line: string) => void;
}

/** Veröffentlicht die gepackte Datei; der Exit 0 von vsce publish ist die Bestätigung. */
export const publishVsix = (options: PublishOptions): void => {
  const hide = redacting(options.token);
  const published = options.vsce(["publish", "--packagePath", options.vsix], { cwd: extensionRoot, token: options.token });
  const output = `${published.stdout}${published.stderr}`;
  for (const line of output.split("\n")) if (line.trim()) options.log(hide(line));
  if (published.status !== 0) throw new Error(`vsce publish endete mit Code ${published.status}.`);
  options.log(`== Veröffentlicht: ${EXTENSION_ID}@${options.version}`);
};

const run = (command: string, args: readonly string[], cwd: string): void => {
  const result = spawnSync(command, [...args], { cwd, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw new Error(`${command} ${args[0]} konnte nicht gestartet werden: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} endete mit Code ${result.status ?? 1}`);
};

/** vsce nimmt README und Lizenz nur aus dem Ordner der Erweiterung; dort liegen sie für den Lauf als Kopien. */
const withMarketplaceFiles = <T>(action: () => T): T => {
  const copies = ["README.md", "LICENSE"].map((name) => ({
    source: path.join(repositoryRoot, name),
    target: path.join(extensionRoot, name),
  }));
  for (const copy of copies) copyFileSync(copy.source, copy.target);
  try {
    return action();
  } finally {
    for (const copy of copies) rmSync(copy.target, { force: true });
  }
};

const packageExtension = (log: (line: string) => void): string => {
  run("pnpm", ["--filter", EXTENSION_NAME, "build"], repositoryRoot);
  mkdirSync(outputFolder, { recursive: true });
  const vsix = path.join(outputFolder, `${EXTENSION_NAME}-${readVersion(manifestFile)}.vsix`);
  withMarketplaceFiles(() => run("pnpm", ["dlx", `@vscode/vsce@${VSCE_VERSION}`, "package", "--no-dependencies", "--out", vsix], extensionRoot));
  log(`== Gepackt: ${path.relative(repositoryRoot, vsix)}`);
  return vsix;
};

const listContents = (log: (line: string) => void): void => {
  const listed = withMarketplaceFiles(() => runVsce(["ls", "--no-dependencies"], { cwd: extensionRoot }));
  if (listed.status !== 0) throw new Error(`vsce ls endete mit Code ${listed.status}: ${oneLine(listed.stderr)}`);
  for (const line of listed.stdout.split("\n")) if (line.trim()) log(line.trim());
};

const main = (): void => {
  const packageOnly = process.argv.includes("--package-only");
  const dryRun = process.argv.includes("--dry-run");
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--dry-run" && argument !== "--package-only");
  if (unknown.length) throw new Error(`Unbekanntes Argument: ${unknown.join(" ")}\n${usage}`);
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Record<string, unknown>;
  assertHostPackageVersion(manifest, expectedHostPackageVersion());
  const token = packageOnly ? "" : process.env[TOKEN_KEY] ?? "";
  if (!packageOnly && !token) throw new Error(`${TOKEN_KEY} fehlt: der Marketplace-Token mit Schreibrecht für ${PUBLISHER}.\n${usage}`);
  if (token) verifyToken(PUBLISHER, token, runVsce);
  const published = packageOnly ? [] : publishedVersions(EXTENSION_ID, runVsce);
  const next = nextVersion(readVersion(manifestFile), published);
  if (!packageOnly) console.log(versionLine(next));
  if (!packageOnly && !dryRun) writeVersion(manifestFile, next.version);
  const plan = publishPlan(manifest, published, next.version);
  console.log(`== ${plan.extensionId}@${plan.version}, VS Code ${(manifest.engines as { vscode: string }).vscode}`);
  const vsix = packageExtension((line) => console.log(line));
  if (packageOnly) return;
  if (dryRun) {
    listContents((line) => console.log(line));
    console.log("== Probelauf: nichts veröffentlicht");
    return;
  }
  publishVsix({ vsix, version: plan.version, token, vsce: runVsce, log: (line) => console.log(line) });
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
