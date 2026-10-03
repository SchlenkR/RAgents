import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coreContracts } from "../../apps/server/src/api/contracts.ts";
import { RpcClient } from "../../apps/web/src/rpc/client.ts";
import { BROWSER_EXECUTABLE_VARIABLE } from "../../plugins/ragents.browser/executor/contract.ts";
import { CHECK_SKILL, CONTAINER_ONLY, runChecks, SERVER_ONLY, type Users } from "./checks.ts";
import {
  buildImage,
  CONTAINER_FOLDER,
  containerLogs,
  dockerServer,
  imageTag,
  pruneOldImages,
  removeOrphanedContainers,
  removeSessionContainers,
  startContainer,
  writeContainerFile,
  type ImageVariant,
} from "./container.ts";
import {
  alive,
  childEnvironment,
  hasExited,
  markedProcesses,
  orphanedProcesses,
  spawnHostServer,
  stopMarkedProcess,
  stopOwnProcess,
  type MarkedProcess,
} from "./processes.ts";
import { config as profile } from "./ragents.config.remote-check.ts";
import { expect, passed, Report } from "./report.ts";
import { startScriptModel, type ScriptModel } from "./script-model.ts";
import { hostTestTasks, prepareVscodeProject, startVscodeHostTest, vscodeOutcome } from "./vscode-step.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const PROFILE = "remote-check";
const PROFILE_FILE = path.join(root, "scripts/remote-workspace", `ragents.config.${PROFILE}.ts`);
/** Every child process of the runner inherits this marker with the value <runner PID>-<session>; the cleanup finds them through it. */
const SESSION_MARKER = "RAGENTS_REMOTE_CHECK_SESSION";
/** The server gets only these variables of the caller; profile keys from the shell would otherwise override the check profile. */
const SERVER_INHERITS = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR"] as const;
const USER_IDS = ["alice", "bob", "admin"] as const;
/** This long processes of the check run may wind down by themselves after the end, such as Electron's crash handler. */
const LINGER_MS = 15_000;

const usage = `Usage: pnpm check:remote-workspace [--shared-path] [--vscode] [--browser]

Checks runs whose workspace is on another machine: a Linux container is the workspace, a
dedicated server on this machine with alice, bob and admin is the host, a script model instead
of a language model drives the tools. At the end everything is cleaned up.

  --shared-path  the folder in the container has the same path as a copy with different content on
                 this machine, instead of ${CONTAINER_FOLDER}, which does not exist here
  --vscode       additionally the VS Code host test against the same server (opens its own window)
  --browser      additionally browser_navigate on a page in the container (image with Chromium)`;

const FLAGS = ["--shared-path", "--vscode", "--browser"] as const;

interface Options {
  readonly sharedPath: boolean;
  readonly vscode: boolean;
  readonly browser: boolean;
}

const parseArguments = (argv: readonly string[]): Options | undefined => {
  if (argv.includes("--help")) return undefined;
  const unknown = argv.filter((argument) => !(FLAGS as readonly string[]).includes(argument));
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown.join(" ")}\n\n${usage}`);
  return { sharedPath: argv.includes("--shared-path"), vscode: argv.includes("--vscode"), browser: argv.includes("--browser") };
};

/** What the runner has started or created; the cleanup touches only what is listed here. */
class Owned {
  temp: string | undefined;
  model: ScriptModel | undefined;
  server: ChildProcess | undefined;
  serverUrl: string | undefined;
  decoy: ChildProcess | undefined;
  vscode: ChildProcess | undefined;
}

interface Session {
  readonly id: string;
  readonly runId: string;
  readonly nonce: string;
  readonly secrets: Readonly<Record<(typeof USER_IDS)[number], { readonly password: string; readonly token: string }>>;
  readonly modelToken: string;
}

const secret = (): string => randomBytes(24).toString("base64url");

const sessionMarker = (session: Session): string => `${process.pid}-${session.id}`;

const TEMP_PREFIX = "ragents-rwc-";
const RUNNER_FILE = "runner.pid";

/** Temp folders of earlier check runs whose runner is no longer alive; without its PID file a folder stays untouched. */
const removeOrphanedTempFolders = (): readonly string[] => readdirSync("/tmp").flatMap((name) => {
  if (!name.startsWith(TEMP_PREFIX)) return [];
  const folder = path.join("/tmp", name);
  const file = path.join(folder, RUNNER_FILE);
  if (!existsSync(file)) return [];
  const runner = Number(readFileSync(file, "utf8").trim());
  if (!Number.isInteger(runner) || runner <= 0 || alive(runner)) return [];
  rmSync(folder, { recursive: true, force: true });
  return [folder];
});

const userClient = (url: string, token: string): RpcClient => new RpcClient({
  baseUrl: url,
  fetch: (input, init) => fetch(input, { ...init, headers: { ...init?.headers as Record<string, string> | undefined, authorization: `Bearer ${token}` } }),
});

const serverEnvironment = (session: Session, dataDirectory: string, skillsDirectory: string, modelUrl: string, browser: boolean, profilePlugins: readonly string[]): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(SERVER_INHERITS.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]!]])),
  PRODUCT_PROFILE: PROFILE,
  PRODUCT_PROFILE_FILE: PROFILE_FILE,
  DATA_DIR: dataDirectory,
  SKILLS_DIR: skillsDirectory,
  REMOTE_CHECK_MODEL_URL: modelUrl,
  REMOTE_CHECK_MODEL_TOKEN: session.modelToken,
  ...Object.fromEntries(USER_IDS.flatMap((id) => [
    [`REMOTE_CHECK_${id.toUpperCase()}_PASSWORD`, session.secrets[id].password],
    [`REMOTE_CHECK_${id.toUpperCase()}_TOKEN`, session.secrets[id].token],
  ])),
  RAGENTS_PARENT_PID: String(process.pid),
  [SESSION_MARKER]: sessionMarker(session),
  ...(browser ? { PLUGINS: JSON.stringify([...profilePlugins, "ragents.browser"]) } : {}),
});

const exitCodeWithin = (child: ChildProcess, timeoutMs: number): Promise<number | null> => new Promise((resolve, reject) => {
  if (hasExited(child)) {
    resolve(child.exitCode);
    return;
  }
  const timer = setTimeout(() => reject(new Error(`no response after ${timeoutMs / 60_000} min`)), timeoutMs);
  child.once("exit", (code) => {
    clearTimeout(timer);
    resolve(code);
  });
});

const runVscodeStep = async (report: Report, owned: Owned, session: Session, serverUrl: string, dataDirectory: string, temp: string): Promise<void> => {
  await report.check("VS Code", "host test with binding client against the check server", async () => {
    const folder = path.join(temp, "vscode-project");
    await prepareVscodeProject(folder);
    const environment = childEnvironment({
      RAGENTS_HOST_TEST_SERVER: serverUrl,
      RAGENTS_HOST_TEST_LOGIN: `bob:${session.secrets.bob.password}`,
      RAGENTS_HOST_TEST_WORKSPACE: folder,
      DATA_DIR: dataDirectory,
      [SESSION_MARKER]: sessionMarker(session),
    }, ["RAGENTS_HOST_TEST_SECOND", "RAGENTS_HOST_TEST_PROFILE", "RAGENTS_HOST_TEST_SETTINGS", "RAGENTS_HOST_TEST_VSIX", "RAGENTS_HOST_TEST_TOKEN"]);
    const run = startVscodeHostTest(root, environment, path.join(temp, "vscode.log"));
    owned.vscode = run.child;
    const code = await exitCodeWithin(run.child, 12 * 60_000).catch(async (error: unknown) => {
      await stopOwnProcess(run.child, 20_000, true);
      throw error;
    });
    const outcome = vscodeOutcome(run.logFile, code);
    expect(outcome.ok, outcome.detail);
    return passed(outcome.detail);
  });
};

/** The check server's runs; the cleanup finds their markers on this machine. */
const serverRunIds = async (owned: Owned, session: Session): Promise<readonly string[]> => {
  if (!owned.server || !owned.serverUrl || hasExited(owned.server)) return [session.runId];
  const listed = await userClient(owned.serverUrl, session.secrets.admin.token).call(coreContracts.runs.list, {});
  return [...new Set([session.runId, ...listed.map((entry) => entry.id)])];
};

const cleanUp = async (report: Report, owned: Owned, session: Session): Promise<void> => {
  const step = (title: string, run: () => Promise<string>): Promise<true | undefined> => report.final("Cleanup", title, async () => passed(await run()));
  if (owned.vscode) await step("VS Code launcher and test instance", () => stopOwnProcess(owned.vscode!, 20_000, true));
  if (owned.temp) {
    const logs = await containerLogs(`ragents-rwc-${session.id}`).catch((error: unknown) => `no log: ${error instanceof Error ? error.message : String(error)}`);
    writeFileSync(path.join(owned.temp, "workspace.log"), logs);
    const exchanges = (owned.model?.exchanges ?? []).map((exchange) => JSON.stringify({ ...exchange, systemPrompt: exchange.step === 0 ? exchange.systemPrompt : "" }));
    writeFileSync(path.join(owned.temp, "script-model.log"), `${exchanges.join("\n")}\n`);
  }
  await step("containers of this session", async () => `${(await removeSessionContainers(session.id)).length} removed`);
  const runIds = await serverRunIds(owned, session).catch((error: unknown) => {
    console.log(`== The server's runs are not readable (${error instanceof Error ? error.message : String(error)}); checking only ${session.runId}`);
    return [session.runId];
  });
  if (owned.decoy) await step("decoy process on this machine", () => stopOwnProcess(owned.decoy!, 2_000, false));
  if (owned.server) await step("Server", () => stopOwnProcess(owned.server!, 20_000, true));
  if (owned.model) await step("Script model", async () => { await owned.model!.close(); return "ended"; });
  await step("no processes of the check run left on this machine", async () => {
    const markers = [...runIds.map((id) => `RAGENTS_RUN_ID=${id}`), `${SESSION_MARKER}=${sessionMarker(session)}`];
    const describe = (entries: readonly MarkedProcess[]): string => entries.map((entry) => `PID ${entry.pid} (${entry.command})`).join(", ");
    const first = await markedProcesses(markers);
    const deadline = Date.now() + LINGER_MS;
    while ((await markedProcesses(markers)).length > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
    const left = await markedProcesses(markers);
    for (const entry of left) await stopMarkedProcess(entry.pid, markers);
    expect(left.length === 0, `${LINGER_MS / 1000} s after the end ${describe(left)} were still running; now ended`);
    const settled = first.filter((entry) => !left.some((other) => other.pid === entry.pid));
    const ended = settled.length > 0 ? `; ended by themselves: ${describe(settled)}` : "";
    return `${runIds.length} run markers and the session marker checked${ended}`;
  });
  await step("containers checked again after the end", async () => `${(await removeSessionContainers(session.id)).length} removed`);
  await step("old images of the runner", async () => (await pruneOldImages()).trim().split("\n").at(-1) ?? "");
  if (owned.temp) await step("Temp folder", async () => {
    const kept = report.failed ? keepLogs(owned.temp!, session) : undefined;
    rmSync(owned.temp!, { recursive: true, force: true });
    return `${owned.temp} deleted${kept ? `; the logs are under ${kept}` : ""}`;
  });
};

/** After a failure the logs of server, workspace, image and VS Code remain; the folder has no PID file and stays during the next check run. */
const keepLogs = (temp: string, session: Session): string | undefined => {
  const logs = readdirSync(temp).filter((name) => name.endsWith(".log"));
  if (logs.length === 0) return undefined;
  const target = path.join("/tmp", `ragents-rwc-logs-${session.id}`);
  mkdirSync(target);
  for (const name of logs) renameSync(path.join(temp, name), path.join(target, name));
  return target;
};

const runPhases = async (options: Options, report: Report, owned: Owned, session: Session): Promise<void> => {
  const ready = await report.check("Prerequisites", "Docker answers", async () => passed(await dockerServer()));
  if (!ready) return;
  if (!options.sharedPath) {
    const free = await report.check("Prerequisites", `${CONTAINER_FOLDER} does not exist on this machine`, async () => {
      expect(!existsSync(CONTAINER_FOLDER), `${CONTAINER_FOLDER} exists here; the server could confuse it with the folder in the container without it being noticed`);
      return passed("missing as expected");
    });
    if (!free) return;
  }
  await report.check("Prerequisites", "orphaned containers of earlier check runs", async () => passed(`${(await removeOrphanedContainers()).length} removed`));
  await report.check("Prerequisites", "orphaned temp folders of earlier check runs", async () => passed(`${removeOrphanedTempFolders().length} removed`));
  await report.check("Prerequisites", "orphaned processes of earlier check runs", async () => {
    const orphaned = await orphanedProcesses(SESSION_MARKER);
    for (const entry of orphaned) await stopMarkedProcess(entry.pid, [entry.marker]);
    return passed(orphaned.length > 0 ? `ended: ${orphaned.map((entry) => `PID ${entry.pid} (${entry.command})`).join(", ")}` : "none");
  });

  // Under /tmp, because DATA_DIR must not be inside a project and the user's temp folder can carry a package.json.
  const temp = realpathSync(mkdtempSync(path.join("/tmp", TEMP_PREFIX)));
  owned.temp = temp;
  writeFileSync(path.join(temp, RUNNER_FILE), String(process.pid));
  const dataDirectory = path.join(temp, "data");
  const skillsDirectory = path.join(temp, "skills");
  mkdirSync(path.join(skillsDirectory, CHECK_SKILL), { recursive: true });
  writeFileSync(path.join(skillsDirectory, CHECK_SKILL, "SKILL.md"),
    `---\nname: ${CHECK_SKILL}\ndescription: Arrange the check run's notes according to the template next to it.\n---\nRead template.md in this skill's folder.\n`);
  writeFileSync(path.join(skillsDirectory, CHECK_SKILL, "template.md"), `# Template\n\nNonce ${session.nonce}\n`);
  const folder = options.sharedPath ? path.join(temp, "project") : CONTAINER_FOLDER;
  if (options.sharedPath) {
    mkdirSync(folder);
    writeFileSync(path.join(folder, "README.md"), "# Copy on the server\n\nNo tool of the run may read this file.\n");
    writeFileSync(path.join(folder, SERVER_ONLY), "This file exists only on the server.\n");
    console.log(`== ${folder} exists on this machine with different content, in the container with the nonce ${session.nonce}`);
  }
  const variant: ImageVariant = options.browser ? "browser" : "plain";
  const image = await report.check("Infrastructure", `build host package and image ${imageTag(variant)}`, async () => {
    const built = await buildImage(root, path.join(temp, "image"), variant, path.join(temp, "docker-build.log"));
    return { value: built, detail: `@schlenkr/ragents ${built.packageVersion}, commit ${built.hostVersion.slice(0, 8)} with working tree, ${built.dependencies} dependencies` };
  });
  if (!image) return;
  const model = await report.check("Infrastructure", "script model starts", async () => {
    owned.model = await startScriptModel(session.modelToken, options.vscode ? hostTestTasks : []);
    return { value: owned.model, detail: owned.model.url };
  });
  if (!model) return;
  const server = await report.check("Infrastructure", "server starts with sign-in for alice, bob and admin", async () => {
    const spawned = spawnHostServer(root, serverEnvironment(session, dataDirectory, skillsDirectory, model.url, options.browser, profile.host.PLUGINS),
      path.join(temp, "server.log"), 120_000);
    owned.server = spawned.child;
    const url = await spawned.announced;
    owned.serverUrl = url;
    for (const id of USER_IDS) {
      const access = await (await fetch(`${url}/api/access`, { headers: { authorization: `Bearer ${session.secrets[id].token}` } })).json() as { enabled?: boolean; user?: { id?: string } | null };
      expect(access.enabled === true && access.user?.id === id, `The token of ${id} reports ${JSON.stringify(access)}`);
    }
    const anonymous = await (await fetch(`${url}/api/access`)).json() as { enabled?: boolean; user?: unknown };
    expect(anonymous.enabled === true && anonymous.user === null, `Without a token the server reports ${JSON.stringify(anonymous)}`);
    return { value: { url }, detail: `${url}, PID ${spawned.child.pid}, data under ${dataDirectory}` };
  });
  if (!server) return;

  const container = { name: `ragents-rwc-${session.id}`, hostname: `rwc-${session.id}`, clientId: `check-${session.id}`, label: "Check container" };
  const running = await report.check("Infrastructure", "container with headless workspace starts", async () => {
    await startContainer({
      variant,
      name: container.name,
      session: session.id,
      hostname: container.hostname,
      serverUrl: `http://host.docker.internal:${new URL(server.url).port}`,
      folder,
      clientId: container.clientId,
      label: container.label,
      token: session.secrets.alice.token,
      // Also without Chromium in the image, so the workspace's provisioning downloads no browser.
      env: { [BROWSER_EXECUTABLE_VARIABLE]: "/usr/bin/chromium" },
    });
    await writeContainerFile(container.name, path.join(folder, "README.md"), `# Check project in the container\n\nNonce ${session.nonce}\n`);
    await writeContainerFile(container.name, path.join(folder, CONTAINER_ONLY), `This file exists only in the container ${container.hostname}.\n`);
    return passed(`${container.name}, ragents workspace-client for alice on ${folder}`);
  });
  if (!running) return;

  // Node instead of /bin/sleep: ps -E does not show the environment of an Apple platform binary, the comparison would be ineffective.
  const decoy = spawn(process.execPath, ["-e", "setTimeout(() => {}, 2718 * 1000)", "decoy-process-2718"],
    { env: childEnvironment({ RAGENTS_RUN_ID: session.runId, [SESSION_MARKER]: sessionMarker(session) }), stdio: "ignore" });
  owned.decoy = decoy;
  const users: Users = {
    alice: userClient(server.url, session.secrets.alice.token),
    bob: userClient(server.url, session.secrets.bob.token),
    admin: userClient(server.url, session.secrets.admin.token),
  };
  await runChecks({
    report,
    users,
    model,
    dataDirectory,
    skillsDirectory,
    container,
    folder,
    serverCopy: options.sharedPath,
    runId: session.runId,
    nonce: session.nonce,
    decoyPid: decoy.pid!,
    browserPort: options.browser ? randomInt(20_000, 40_000) : undefined,
  });
  if (options.vscode) await runVscodeStep(report, owned, session, server.url, dataDirectory, temp);
};

const main = async (): Promise<number> => {
  const options = parseArguments(process.argv.slice(2));
  if (!options) {
    console.log(usage);
    return 0;
  }
  if (process.platform !== "darwin") throw new Error("The runner is built for macOS with OrbStack or Docker Desktop: host.docker.internal reaches the server on 127.0.0.1 there, and ps -E shows the markers for the cleanup.");
  const started = Date.now();
  const session: Session = {
    id: randomBytes(6).toString("hex"),
    runId: randomUUID(),
    nonce: randomBytes(8).toString("hex"),
    secrets: { alice: { password: secret(), token: secret() }, bob: { password: secret(), token: secret() }, admin: { password: secret(), token: secret() } },
    modelToken: secret(),
  };
  const report = new Report((line) => console.log(line));
  const owned = new Owned();
  const cleaning: { done?: Promise<void> } = {};
  const cleanUpOnce = (): Promise<void> => cleaning.done ??= cleanUp(report, owned, session);
  const abort = (reason: string, exitCode: number): void => {
    if (cleaning.done) {
      console.log(`== ${reason}; the cleanup is already running`);
      return;
    }
    console.log(`== ${reason}; cleaning up`);
    report.abort();
    void cleanUpOnce().finally(() => {
      console.log(`== aborted: ${report.summary()}`);
      process.exit(exitCode);
    });
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => abort(`Signal ${signal}`, 130));
  process.on("uncaughtException", (error) => abort(`Unhandled error: ${error.stack ?? error.message}`, 1));
  process.on("unhandledRejection", (reason) => abort(`Unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`, 1));

  const extras = [options.sharedPath ? "same path on both sides" : "", options.vscode ? "with VS Code" : "", options.browser ? "with browser" : ""].filter(Boolean);
  console.log(`== Check run ${session.id}: workspace in the Linux container, server on this machine${extras.length > 0 ? ` (${extras.join(", ")})` : ""}`);
  try {
    await runPhases(options, report, owned, session);
  } finally {
    await cleanUpOnce();
  }
  console.log(`== ${report.summary()} in ${Math.round((Date.now() - started) / 1000)} s`);
  return report.failed ? 1 : 0;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
