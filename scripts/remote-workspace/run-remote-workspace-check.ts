import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BROWSER_EXECUTABLE_VARIABLE } from "@ragents/workspace-executor";
import { coreContracts } from "../../apps/server/src/api/contracts.ts";
import { RpcClient } from "../../apps/web/src/rpc/client.ts";
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
/** Jeder Kindprozess des Läufers erbt diese Markierung mit dem Wert <Läufer-PID>-<Sitzung>; das Aufräumen findet sie darüber. */
const SESSION_MARKER = "RAGENTS_REMOTE_CHECK_SESSION";
/** Der Server bekommt nur diese Variablen des Aufrufers; Profilschlüssel aus der Shell würden das Prüfprofil sonst überstimmen. */
const SERVER_INHERITS = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR"] as const;
const USER_IDS = ["alice", "bob", "admin"] as const;
/** So lange dürfen Prozesse des Prüflaufs nach dem Ende von selbst ausklingen, etwa der Crash-Handler von Electron. */
const LINGER_MS = 15_000;

const usage = `Verwendung: pnpm check:remote-workspace [--shared-path] [--vscode] [--browser]

Prüft Runs, deren Arbeitsbereich auf einem anderen Rechner liegt: ein Linux-Container ist der
Arbeitsplatz, ein eigener Server auf diesem Rechner mit alice, bob und admin der Host, ein
Skriptmodell statt eines Sprachmodells steuert die Werkzeuge. Am Ende ist alles aufgeräumt.

  --shared-path  der Ordner im Container hat denselben Pfad wie eine Kopie mit anderem Inhalt auf
                 diesem Rechner, statt ${CONTAINER_FOLDER}, den es hier nicht gibt
  --vscode       zusätzlich den VS-Code-Host-Test gegen denselben Server (öffnet ein eigenes Fenster)
  --browser      zusätzlich browser_open auf eine Seite im Container (Image mit Chromium)`;

const FLAGS = ["--shared-path", "--vscode", "--browser"] as const;

interface Options {
  readonly sharedPath: boolean;
  readonly vscode: boolean;
  readonly browser: boolean;
}

const parseArguments = (argv: readonly string[]): Options | undefined => {
  if (argv.includes("--help")) return undefined;
  const unknown = argv.filter((argument) => !(FLAGS as readonly string[]).includes(argument));
  if (unknown.length > 0) throw new Error(`Unbekanntes Argument: ${unknown.join(" ")}\n\n${usage}`);
  return { sharedPath: argv.includes("--shared-path"), vscode: argv.includes("--vscode"), browser: argv.includes("--browser") };
};

/** Was der Läufer gestartet oder angelegt hat; das Aufräumen fasst nur an, was hier steht. */
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

/** Temp-Ordner früherer Prüfläufe, deren Läufer nicht mehr lebt; ohne dessen PID-Datei bleibt ein Ordner unberührt. */
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
  const timer = setTimeout(() => reject(new Error(`keine Rückmeldung nach ${timeoutMs / 60_000} min`)), timeoutMs);
  child.once("exit", (code) => {
    clearTimeout(timer);
    resolve(code);
  });
});

const runVscodeStep = async (report: Report, owned: Owned, session: Session, serverUrl: string, dataDirectory: string, temp: string): Promise<void> => {
  await report.check("VS Code", "Host-Test mit Bindung client gegen den Prüfserver", async () => {
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

/** Die Runs des Prüfservers; ihre Marker findet das Aufräumen auf diesem Rechner. */
const serverRunIds = async (owned: Owned, session: Session): Promise<readonly string[]> => {
  if (!owned.server || !owned.serverUrl || hasExited(owned.server)) return [session.runId];
  const listed = await userClient(owned.serverUrl, session.secrets.admin.token).call(coreContracts.runs.list, {});
  return [...new Set([session.runId, ...listed.map((entry) => entry.id)])];
};

const cleanUp = async (report: Report, owned: Owned, session: Session): Promise<void> => {
  const step = (title: string, run: () => Promise<string>): Promise<true | undefined> => report.final("Aufräumen", title, async () => passed(await run()));
  if (owned.vscode) await step("VS-Code-Launcher und Testinstanz", () => stopOwnProcess(owned.vscode!, 20_000, true));
  if (owned.temp) {
    const logs = await containerLogs(`ragents-rwc-${session.id}`).catch((error: unknown) => `kein Protokoll: ${error instanceof Error ? error.message : String(error)}`);
    writeFileSync(path.join(owned.temp, "arbeitsplatz.log"), logs);
    const exchanges = (owned.model?.exchanges ?? []).map((exchange) => JSON.stringify({ ...exchange, systemPrompt: exchange.step === 0 ? exchange.systemPrompt : "" }));
    writeFileSync(path.join(owned.temp, "skriptmodell.log"), `${exchanges.join("\n")}\n`);
  }
  await step("Container dieser Sitzung", async () => `${(await removeSessionContainers(session.id)).length} entfernt`);
  const runIds = await serverRunIds(owned, session).catch((error: unknown) => {
    console.log(`== Die Runs des Servers sind nicht lesbar (${error instanceof Error ? error.message : String(error)}); geprüft wird nur ${session.runId}`);
    return [session.runId];
  });
  if (owned.decoy) await step("Vergleichsprozess auf diesem Rechner", () => stopOwnProcess(owned.decoy!, 2_000, false));
  if (owned.server) await step("Server", () => stopOwnProcess(owned.server!, 20_000, true));
  if (owned.model) await step("Skriptmodell", async () => { await owned.model!.close(); return "beendet"; });
  await step("keine Prozesse des Prüflaufs mehr auf diesem Rechner", async () => {
    const markers = [...runIds.map((id) => `RAGENTS_RUN_ID=${id}`), `${SESSION_MARKER}=${sessionMarker(session)}`];
    const describe = (entries: readonly MarkedProcess[]): string => entries.map((entry) => `PID ${entry.pid} (${entry.command})`).join(", ");
    const first = await markedProcesses(markers);
    const deadline = Date.now() + LINGER_MS;
    while ((await markedProcesses(markers)).length > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
    const left = await markedProcesses(markers);
    for (const entry of left) await stopMarkedProcess(entry.pid, markers);
    expect(left.length === 0, `${LINGER_MS / 1000} s nach dem Ende liefen noch ${describe(left)}; jetzt beendet`);
    const settled = first.filter((entry) => !left.some((other) => other.pid === entry.pid));
    const ended = settled.length > 0 ? `; von selbst beendet: ${describe(settled)}` : "";
    return `${runIds.length} Run-Marker und die Sitzungsmarkierung geprüft${ended}`;
  });
  await step("Container nach dem Ende erneut geprüft", async () => `${(await removeSessionContainers(session.id)).length} entfernt`);
  await step("alte Images des Läufers", async () => (await pruneOldImages()).trim().split("\n").at(-1) ?? "");
  if (owned.temp) await step("Temp-Ordner", async () => {
    const kept = report.failed ? keepLogs(owned.temp!, session) : undefined;
    rmSync(owned.temp!, { recursive: true, force: true });
    return `${owned.temp} gelöscht${kept ? `; die Protokolle liegen unter ${kept}` : ""}`;
  });
};

/** Nach einem Fehlschlag bleiben die Protokolle von Server, Arbeitsplatz, Image und VS Code; der Ordner ist ohne PID-Datei und bleibt beim nächsten Prüflauf liegen. */
const keepLogs = (temp: string, session: Session): string | undefined => {
  const logs = readdirSync(temp).filter((name) => name.endsWith(".log"));
  if (logs.length === 0) return undefined;
  const target = path.join("/tmp", `ragents-rwc-protokoll-${session.id}`);
  mkdirSync(target);
  for (const name of logs) renameSync(path.join(temp, name), path.join(target, name));
  return target;
};

const runPhases = async (options: Options, report: Report, owned: Owned, session: Session): Promise<void> => {
  const ready = await report.check("Voraussetzungen", "Docker antwortet", async () => passed(await dockerServer()));
  if (!ready) return;
  if (!options.sharedPath) {
    const free = await report.check("Voraussetzungen", `${CONTAINER_FOLDER} gibt es auf diesem Rechner nicht`, async () => {
      expect(!existsSync(CONTAINER_FOLDER), `${CONTAINER_FOLDER} existiert hier; der Server könnte ihn mit dem Ordner im Container verwechseln, ohne dass es auffällt`);
      return passed("fehlt wie erwartet");
    });
    if (!free) return;
  }
  await report.check("Voraussetzungen", "verwaiste Container früherer Prüfläufe", async () => passed(`${(await removeOrphanedContainers()).length} entfernt`));
  await report.check("Voraussetzungen", "verwaiste Temp-Ordner früherer Prüfläufe", async () => passed(`${removeOrphanedTempFolders().length} entfernt`));
  await report.check("Voraussetzungen", "verwaiste Prozesse früherer Prüfläufe", async () => {
    const orphaned = await orphanedProcesses(SESSION_MARKER);
    for (const entry of orphaned) await stopMarkedProcess(entry.pid, [entry.marker]);
    return passed(orphaned.length > 0 ? `beendet: ${orphaned.map((entry) => `PID ${entry.pid} (${entry.command})`).join(", ")}` : "keine");
  });

  // Unter /tmp, weil DATA_DIR nicht in einem Projekt liegen darf und der Temp-Ordner des Benutzers eine package.json tragen kann.
  const temp = realpathSync(mkdtempSync(path.join("/tmp", TEMP_PREFIX)));
  owned.temp = temp;
  writeFileSync(path.join(temp, RUNNER_FILE), String(process.pid));
  const dataDirectory = path.join(temp, "data");
  const skillsDirectory = path.join(temp, "skills");
  mkdirSync(path.join(skillsDirectory, CHECK_SKILL), { recursive: true });
  writeFileSync(path.join(skillsDirectory, CHECK_SKILL, "SKILL.md"),
    `---\nname: ${CHECK_SKILL}\ndescription: Notizen des Prüflaufs nach der Vorlage daneben ordnen.\n---\nLies vorlage.md im Ordner dieses Skills.\n`);
  writeFileSync(path.join(skillsDirectory, CHECK_SKILL, "vorlage.md"), `# Vorlage\n\nKennung ${session.nonce}\n`);
  const folder = options.sharedPath ? path.join(temp, "projekt") : CONTAINER_FOLDER;
  if (options.sharedPath) {
    mkdirSync(folder);
    writeFileSync(path.join(folder, "README.md"), "# Kopie auf dem Server\n\nDiese Datei darf kein Werkzeug des Runs lesen.\n");
    writeFileSync(path.join(folder, SERVER_ONLY), "Diese Datei gibt es nur auf dem Server.\n");
    console.log(`== ${folder} gibt es auf diesem Rechner mit anderem Inhalt, im Container mit der Kennung ${session.nonce}`);
  }
  const variant: ImageVariant = options.browser ? "browser" : "plain";
  const image = await report.check("Infrastruktur", `Host-Paket und Image ${imageTag(variant)} bauen`, async () => {
    const built = await buildImage(root, path.join(temp, "image"), variant, path.join(temp, "docker-build.log"));
    return { value: built, detail: `@schlenkr/ragents ${built.packageVersion}, Commit ${built.hostVersion.slice(0, 8)} mit Arbeitsstand, ${built.dependencies} Abhängigkeiten` };
  });
  if (!image) return;
  const model = await report.check("Infrastruktur", "Skriptmodell startet", async () => {
    owned.model = await startScriptModel(session.modelToken, options.vscode ? hostTestTasks : []);
    return { value: owned.model, detail: owned.model.url };
  });
  if (!model) return;
  const server = await report.check("Infrastruktur", "Server startet mit Anmeldung für alice, bob und admin", async () => {
    const spawned = spawnHostServer(root, serverEnvironment(session, dataDirectory, skillsDirectory, model.url, options.browser, profile.host.PLUGINS),
      path.join(temp, "server.log"), 120_000);
    owned.server = spawned.child;
    const url = await spawned.announced;
    owned.serverUrl = url;
    for (const id of USER_IDS) {
      const access = await (await fetch(`${url}/api/access`, { headers: { authorization: `Bearer ${session.secrets[id].token}` } })).json() as { enabled?: boolean; user?: { id?: string } | null };
      expect(access.enabled === true && access.user?.id === id, `Der Token von ${id} meldet ${JSON.stringify(access)}`);
    }
    const anonymous = await (await fetch(`${url}/api/access`)).json() as { enabled?: boolean; user?: unknown };
    expect(anonymous.enabled === true && anonymous.user === null, `Ohne Token meldet der Server ${JSON.stringify(anonymous)}`);
    return { value: { url }, detail: `${url}, PID ${spawned.child.pid}, Daten unter ${dataDirectory}` };
  });
  if (!server) return;

  const container = { name: `ragents-rwc-${session.id}`, hostname: `rwc-${session.id}`, clientId: `pruefung-${session.id}`, label: "Prüfcontainer" };
  const running = await report.check("Infrastruktur", "Container mit kopflosem Arbeitsplatz startet", async () => {
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
      // Auch ohne Chromium im Image, damit die Provisionierung des Arbeitsplatzes keinen Browser lädt.
      env: { [BROWSER_EXECUTABLE_VARIABLE]: "/usr/bin/chromium" },
    });
    await writeContainerFile(container.name, path.join(folder, "README.md"), `# Prüfprojekt im Container\n\nKennung ${session.nonce}\n`);
    await writeContainerFile(container.name, path.join(folder, CONTAINER_ONLY), `Diese Datei gibt es nur im Container ${container.hostname}.\n`);
    return passed(`${container.name}, ragents workspace-client für alice auf ${folder}`);
  });
  if (!running) return;

  // Node statt /bin/sleep: die Umgebung eines Apple-Plattformprogramms zeigt ps -E nicht, der Vergleich wäre wirkungslos.
  const decoy = spawn(process.execPath, ["-e", "setTimeout(() => {}, 2718 * 1000)", "vergleichsprozess-2718"],
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
  if (process.platform !== "darwin") throw new Error("Der Läufer ist für macOS mit OrbStack oder Docker Desktop gebaut: host.docker.internal erreicht dort den Server auf 127.0.0.1, und ps -E zeigt die Marker für das Aufräumen.");
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
      console.log(`== ${reason}; das Aufräumen läuft bereits`);
      return;
    }
    console.log(`== ${reason}; räume auf`);
    report.abort();
    void cleanUpOnce().finally(() => {
      console.log(`== abgebrochen: ${report.summary()}`);
      process.exit(exitCode);
    });
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => abort(`Signal ${signal}`, 130));
  process.on("uncaughtException", (error) => abort(`Unbehandelter Fehler: ${error.stack ?? error.message}`, 1));
  process.on("unhandledRejection", (reason) => abort(`Unbehandelte Ablehnung: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`, 1));

  const extras = [options.sharedPath ? "gleicher Pfad auf beiden Seiten" : "", options.vscode ? "mit VS Code" : "", options.browser ? "mit Browser" : ""].filter(Boolean);
  console.log(`== Prüflauf ${session.id}: Arbeitsbereich im Linux-Container, Server auf diesem Rechner${extras.length > 0 ? ` (${extras.join(", ")})` : ""}`);
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
