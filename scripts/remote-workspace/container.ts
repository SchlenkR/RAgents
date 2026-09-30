import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPackage } from "../package/build-package.ts";
import { buildToolsPackages } from "../package/tools-package.ts";
import { alive, childEnvironment, mustRun, runCommand, type CommandResult } from "./processes.ts";

const IMAGE = "ragents-remote-workspace-check";

/** plain is the workspace alone, browser adds Chromium for the browser check in the container. */
export type ImageVariant = "plain" | "browser";

export const imageTag = (variant: ImageVariant): string => `${IMAGE}:${variant}`;

/** Every container and every image of the runner carries these labels; only what carries them is cleaned up. */
export const SESSION_LABEL = "ragents.remote-workspace-check.session";
const RUNNER_LABEL = "ragents.remote-workspace-check.runner";
const IMAGE_LABEL = "ragents.remote-workspace-check.image";

/** The workspace folder that does not exist on the Mac; with --shared-path a path that exists on both sides applies instead. */
export const CONTAINER_FOLDER = "/work/project";

const docker = (args: readonly string[], input?: string): Promise<CommandResult> => runCommand("docker", args, input === undefined ? {} : { input });

const mustDocker = (args: readonly string[], input?: string): Promise<string> => mustRun("docker", args, input === undefined ? {} : { input });

export interface BuiltImage {
  readonly packageVersion: string;
  readonly hostVersion: string;
  readonly dependencies: number;
}

/** Builds the host package from this checkout into the build context and the image from it; npm installs the dependencies in the Linux image. */
export const buildImage = async (root: string, context: string, variant: ImageVariant, logFile: string): Promise<BuiltImage> => {
  const built = await buildPackage(path.join(context, "package"), root);
  const dependencies = built.manifest.dependencies as Record<string, string>;
  const tools = await buildToolsPackages(built.manifest.version as string, path.join(context, "workspace-tools"), ["linux-x64", "linux-arm64"]);
  const optionalDependencies = Object.fromEntries(tools.map((entry) => [entry.name, `file:./workspace-tools/${path.basename(entry.directory)}`]));
  await mkdir(path.join(context, "dependencies"), { recursive: true });
  await writeFile(path.join(context, "dependencies", "package.json"),
    `${JSON.stringify({ name: "ragents-remote-check-dependencies", private: true, type: "module", dependencies, optionalDependencies }, null, 2)}\n`);
  await copyFile(path.join(root, "scripts/remote-workspace/Dockerfile"), path.join(context, "Dockerfile"));
  const result = await docker(["build", "--build-arg", `VARIANT=${variant}`, "--label", `${IMAGE_LABEL}=1`, "--tag", imageTag(variant), context]);
  await writeFile(logFile, `${result.stdout}\n${result.stderr}`);
  if (result.code !== 0) throw new Error(`docker build ended with ${result.code}; end of the log ${logFile}:\n${result.stderr.trim().split("\n").slice(-20).join("\n")}`);
  return {
    packageVersion: built.manifest.version as string,
    hostVersion: (built.manifest.ragents as { hostVersion: string }).hostVersion,
    dependencies: Object.keys(dependencies).length,
  };
};

/** Only unnamed images with the runner's label; the filter does not reach foreign images. */
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
  /** The personal token goes through the environment of the docker call so it appears in no command line. */
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
    "sh", "-c", "mkdir -p \"$1\" && exec ragents workspace-client --detached \"$2\" \"$1\" --id \"$3\" --label \"$4\"",
    "sh", spec.folder, spec.serverUrl, spec.clientId, spec.label,
  ];
  await mustRun("docker", args, { env: childEnvironment({ RAGENTS_TOKEN: spec.token }) });
};

export const stopContainer = (name: string): Promise<string> => mustDocker(["stop", "--time", "25", name]);

export const restartContainer = (name: string): Promise<string> => mustDocker(["start", name]);

/** Takes the network away from the container without stopping it; the workspace inside keeps running, its event stream breaks. */
export const disconnectNetwork = (name: string): Promise<string> => mustDocker(["network", "disconnect", "bridge", name]);

export const connectNetwork = (name: string): Promise<string> => mustDocker(["network", "connect", "bridge", name]);

export const containerLogs = async (name: string): Promise<string> => {
  const result = await docker(["logs", name]);
  return `${result.stdout}\n${result.stderr}`;
};

/** A command as user node in the container; the environment goes along as --env, stdin as input. */
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
  if (result.code !== 0) throw new Error(`${file} cannot be written in the container: ${result.stderr.trim()}`);
};

/** Is the process in the container still running? The container's process table is reachable only through /proc there. */
export const containerProcessAlive = async (name: string, pid: number): Promise<boolean> =>
  (await containerExec(name, ["test", "-d", `/proc/${pid}`])).code === 0;

/** Containers of this session; all carry the session label. */
export const removeSessionContainers = async (session: string): Promise<readonly string[]> => {
  const ids = (await mustDocker(["ps", "--all", "--quiet", "--filter", `label=${SESSION_LABEL}=${session}`])).split("\n").filter(Boolean);
  if (ids.length > 0) await mustDocker(["rm", "--force", ...ids]);
  return ids;
};

/** Containers of earlier check runs whose runner is no longer alive (e.g. after SIGKILL); only containers with the runner's labels. */
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
