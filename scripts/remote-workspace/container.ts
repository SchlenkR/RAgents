import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPackage } from "../package/build-package.ts";
import { alive, childEnvironment, mustRun, runCommand, type CommandResult } from "./processes.ts";

const IMAGE = "ragents-remote-workspace-check";

/** plain ist der Arbeitsplatz allein, browser legt Chromium für die Browserprüfung im Container dazu. */
export type ImageVariant = "plain" | "browser";

export const imageTag = (variant: ImageVariant): string => `${IMAGE}:${variant}`;

/** Jeder Container und jedes Image des Läufers trägt diese Labels; aufgeräumt wird nur, was sie trägt. */
export const SESSION_LABEL = "ragents.remote-workspace-check.session";
const RUNNER_LABEL = "ragents.remote-workspace-check.runner";
const IMAGE_LABEL = "ragents.remote-workspace-check.image";

/** Der Ordner des Arbeitsplatzes, den es auf dem Mac nicht gibt; mit --shared-path gilt stattdessen ein Pfad, den es auf beiden Seiten gibt. */
export const CONTAINER_FOLDER = "/work/project";

const docker = (args: readonly string[], input?: string): Promise<CommandResult> => runCommand("docker", args, input === undefined ? {} : { input });

const mustDocker = (args: readonly string[], input?: string): Promise<string> => mustRun("docker", args, input === undefined ? {} : { input });

export interface BuiltImage {
  readonly packageVersion: string;
  readonly hostVersion: string;
  readonly dependencies: number;
}

/** Baut das Host-Paket aus diesem Checkout in den Build-Kontext und daraus das Image; die Abhängigkeiten installiert npm im Linux-Image. */
export const buildImage = async (root: string, context: string, variant: ImageVariant, logFile: string): Promise<BuiltImage> => {
  const built = await buildPackage(path.join(context, "package"), root);
  const dependencies = built.manifest.dependencies as Record<string, string>;
  await mkdir(path.join(context, "dependencies"), { recursive: true });
  await writeFile(path.join(context, "dependencies", "package.json"),
    `${JSON.stringify({ name: "ragents-remote-check-dependencies", private: true, type: "module", dependencies }, null, 2)}\n`);
  await copyFile(path.join(root, "scripts/remote-workspace/Dockerfile"), path.join(context, "Dockerfile"));
  const result = await docker(["build", "--build-arg", `VARIANT=${variant}`, "--label", `${IMAGE_LABEL}=1`, "--tag", imageTag(variant), context]);
  await writeFile(logFile, `${result.stdout}\n${result.stderr}`);
  if (result.code !== 0) throw new Error(`docker build endete mit ${result.code}; Ende des Protokolls ${logFile}:\n${result.stderr.trim().split("\n").slice(-20).join("\n")}`);
  return {
    packageVersion: built.manifest.version as string,
    hostVersion: (built.manifest.ragents as { hostVersion: string }).hostVersion,
    dependencies: Object.keys(dependencies).length,
  };
};

/** Nur noch unbenannte Images mit dem Label des Läufers; fremde Images erreicht der Filter nicht. */
export const pruneOldImages = (): Promise<string> => mustDocker(["image", "prune", "--force", "--filter", `label=${IMAGE_LABEL}=1`]);

export interface ContainerSpec {
  readonly variant: ImageVariant;
  readonly name: string;
  readonly session: string;
  readonly hostname: string;
  readonly serverUrl: string;
  readonly folder: string;
  readonly clientId: string;
  readonly label: string;
  /** Der persönliche Token geht über die Umgebung des docker-Aufrufs, damit er in keiner Befehlszeile steht. */
  readonly token: string;
  readonly env: Readonly<Record<string, string>>;
}

export const startContainer = async (spec: ContainerSpec): Promise<void> => {
  const args = [
    "run", "--detach", "--init",
    "--name", spec.name,
    "--hostname", spec.hostname,
    "--label", `${SESSION_LABEL}=${spec.session}`,
    "--label", `${RUNNER_LABEL}=${process.pid}`,
    "--env", "RAGENTS_TOKEN",
    ...Object.entries(spec.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    imageTag(spec.variant),
    "sh", "-c", "mkdir -p \"$1\" && exec ragents workspace-client \"$2\" \"$1\" --id \"$3\" --label \"$4\"",
    "sh", spec.folder, spec.serverUrl, spec.clientId, spec.label,
  ];
  await mustRun("docker", args, { env: childEnvironment({ RAGENTS_TOKEN: spec.token }) });
};

export const stopContainer = (name: string): Promise<string> => mustDocker(["stop", "--time", "10", name]);

export const restartContainer = (name: string): Promise<string> => mustDocker(["start", name]);

/** Nimmt dem Container das Netz, ohne ihn anzuhalten; der Arbeitsplatz darin läuft weiter, sein Ereignisstrom bricht. */
export const disconnectNetwork = (name: string): Promise<string> => mustDocker(["network", "disconnect", "bridge", name]);

export const connectNetwork = (name: string): Promise<string> => mustDocker(["network", "connect", "bridge", name]);

export const containerLogs = async (name: string): Promise<string> => {
  const result = await docker(["logs", name]);
  return `${result.stdout}\n${result.stderr}`;
};

/** Ein Befehl als Benutzer node im Container; die Umgebung geht als --env mit, stdin als Eingabe. */
export const containerExec = (name: string, command: readonly string[], options: { detach?: boolean; env?: Readonly<Record<string, string>>; input?: string } = {}): Promise<CommandResult> =>
  docker([
    "exec", "--user", "node",
    ...(options.detach ? ["--detach"] : []),
    ...(options.input !== undefined ? ["--interactive"] : []),
    ...Object.entries(options.env ?? {}).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    name, ...command,
  ], options.input);

export const writeContainerFile = async (name: string, file: string, content: string): Promise<void> => {
  const result = await containerExec(name, ["sh", "-c", `mkdir -p "$(dirname "$1")" && cat > "$1"`, "sh", file], { input: content });
  if (result.code !== 0) throw new Error(`${file} lässt sich im Container nicht schreiben: ${result.stderr.trim()}`);
};

/** Läuft der Prozess im Container noch? Die Prozesstabelle des Containers ist nur über /proc dort erreichbar. */
export const containerProcessAlive = async (name: string, pid: number): Promise<boolean> =>
  (await containerExec(name, ["test", "-d", `/proc/${pid}`])).code === 0;

/** Container dieser Sitzung; alle tragen das Sitzungslabel. */
export const removeSessionContainers = async (session: string): Promise<readonly string[]> => {
  const ids = (await mustDocker(["ps", "--all", "--quiet", "--filter", `label=${SESSION_LABEL}=${session}`])).split("\n").filter(Boolean);
  if (ids.length > 0) await mustDocker(["rm", "--force", ...ids]);
  return ids;
};

/** Container früherer Prüfläufe, deren Läufer nicht mehr lebt (etwa nach SIGKILL); nur Container mit den Labels des Läufers. */
export const removeOrphanedContainers = async (): Promise<readonly string[]> => {
  const listing = await mustDocker(["ps", "--all", "--filter", `label=${SESSION_LABEL}`, "--format", `{{.ID}} {{.Label "${RUNNER_LABEL}"}}`]);
  const orphaned = listing.split("\n").filter(Boolean).flatMap((line) => {
    const [id, runner] = line.split(" ");
    const pid = Number(runner);
    return id && Number.isInteger(pid) && pid > 0 && !alive(pid) ? [id] : [];
  });
  if (orphaned.length > 0) await mustDocker(["rm", "--force", ...orphaned]);
  return orphaned;
};

export const dockerServer = async (): Promise<string> =>
  (await mustDocker(["version", "--format", "{{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}}"])).trim();
