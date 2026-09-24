import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { coreContracts, runContracts } from "../../apps/server/src/api/contracts.ts";
import type { RpcClient } from "../../apps/web/src/rpc/client.ts";
import type { JournalEvent } from "../../packages/ragents/src/domain/events.ts";
import { processesContracts, type RunProcess } from "../../plugins/ragents.processes/contract.ts";
import { WORKSPACE_BINDING_OPTION_ID, workspaceContracts, type WorkspaceBinding } from "../../plugins/ragents.workspace/contract.ts";
import {
  connectNetwork,
  containerExec,
  containerLogs,
  containerProcessAlive,
  disconnectNetwork,
  restartContainer,
  stopContainer,
  writeContainerFile,
} from "./container.ts";
import { alive, markedProcesses } from "./processes.ts";
import { expect, passed, type Checked, type Report } from "./report.ts";
import { scriptedMessage, type ScriptModel, type ScriptProgram } from "./script-model.ts";

export interface Users {
  readonly alice: RpcClient;
  readonly bob: RpcClient;
  readonly admin: RpcClient;
}

export interface ContainerTarget {
  readonly name: string;
  readonly hostname: string;
  readonly clientId: string;
  readonly label: string;
}

export interface CheckEnvironment {
  readonly report: Report;
  readonly users: Users;
  readonly model: ScriptModel;
  readonly dataDirectory: string;
  readonly container: ContainerTarget;
  /** Der Ordner, den der Arbeitsplatz im Container anbietet. */
  readonly folder: string;
  /** Mit --shared-path gibt es denselben Pfad auch auf dem Server, mit anderem Inhalt; sonst gibt es ihn dort nicht. */
  readonly serverCopy: boolean;
  /** Der Run von alice mit Bindung an den Ordner im Container. */
  readonly runId: string;
  /** Steht in README.md im Container und nirgends sonst. */
  readonly nonce: string;
  /** Ein Prozess auf diesem Rechner mit dem Run-Marker; er darf weder angezeigt noch beendet werden. */
  readonly decoyPid: number;
  /** Mit --browser der Port der Prüfseite auf localhost im Container. */
  readonly browserPort: number | undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

const tail = (text: string, lines = 12): string => text.trim().split("\n").slice(-lines).join("\n");

const waitFor = async <T>(attempt: () => Promise<T | undefined>, timeoutMs: number, what: string, intervalMs = 500): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = await attempt();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`${what} bleibt nach ${Math.round(timeoutMs / 1000)} s aus`);
    await sleep(intervalMs);
  }
};

const domainCodeOf = (error: unknown): string | undefined => {
  const code = (error as { data?: { code?: unknown } } | undefined)?.data?.code;
  return typeof code === "string" ? code : undefined;
};

/** Der Aufruf muss mit genau diesem fachlichen Fehlercode scheitern. */
const failsWith = async (call: Promise<unknown>, code: string): Promise<Checked<true>> => {
  const outcome = await call.then(() => ({ failed: false as const }), (error: unknown) => ({ failed: true as const, error }));
  expect(outcome.failed, `Der Aufruf gelingt; erwartet war ${code}`);
  const actual = domainCodeOf(outcome.error);
  expect(actual === code, `Erwartet war ${code}, gemeldet ist ${actual ?? "kein Code"}: ${messageOf(outcome.error)}`);
  return passed(`${code}: ${messageOf(outcome.error)}`);
};

const clientBinding = (env: CheckEnvironment): WorkspaceBinding =>
  ({ kind: "client", client: env.container.clientId, label: env.container.label, path: env.folder });

interface ToolOutcome {
  readonly name: string;
  readonly output: unknown;
  readonly error: string | undefined;
  readonly done: boolean;
}

interface TurnResult {
  readonly tools: readonly ToolOutcome[];
  readonly answer: string;
  /** Die erste Zeile des Grunds, wenn der Turn gescheitert ist. */
  readonly failure: string | undefined;
}

const payloadOf = (event: JournalEvent): Record<string, unknown> => (event as { payload?: Record<string, unknown> }).payload ?? {};

const eventsOf = (rpc: RpcClient, runId: string): Promise<readonly JournalEvent[]> => rpc.call(runContracts.events, { runId });

const toolsOf = (events: readonly JournalEvent[]): readonly ToolOutcome[] => events
  .filter((event) => event.type === "tool.call.started")
  .map((event) => {
    const started = payloadOf(event);
    const end = events.find((other) => (other.type === "tool.call.completed" || other.type === "tool.call.failed")
      && payloadOf(other).toolCallId === started.toolCallId);
    const ended = end ? payloadOf(end) : undefined;
    return {
      name: String(started.name),
      output: ended?.output,
      error: end?.type === "tool.call.failed" ? String(ended?.error) : undefined,
      done: end !== undefined,
    };
  });

interface Attachment {
  readonly name: string;
  readonly mediaType: string;
  readonly data: string;
}

/** Schickt einen Auftrag von alice mit Programm für das Skriptmodell und wartet auf das Ende des Turns, den er auslöst. */
const runScript = async (env: CheckEnvironment, text: string, program: ScriptProgram, attachments: readonly Attachment[] = []): Promise<TurnResult> => {
  const timeoutMs = 60_000;
  const { alice } = env.users;
  const before = (await eventsOf(alice, env.runId).catch(() => [])).length;
  const sending: { error?: unknown } = {};
  void alice.call(coreContracts.chat.send, { runId: env.runId, text: scriptedMessage(text, program), ...(attachments.length > 0 ? { attachments: [...attachments] } : {}) })
    .catch((error: unknown) => { sending.error = error ?? new Error("ohne Grund"); });
  const turn = await waitFor(async () => {
    if (sending.error !== undefined) throw new Error(`ragents.chat.send scheitert: ${messageOf(sending.error)}`);
    const fresh = (await eventsOf(alice, env.runId).catch(() => [])).slice(before);
    const started = fresh.find((event) => event.type === "turn.started");
    if (!started) return undefined;
    const end = fresh.findIndex((event) => (event.type === "turn.finished" || event.type === "turn.interrupted")
      && payloadOf(event).turnId === payloadOf(started).turnId);
    return end < 0 ? undefined : fresh.slice(0, end + 1);
  }, timeoutMs, `Das Ende des Turns zum Programm ${program.id}`, 300);
  const answer = turn.filter((event) => event.type === "model.output.completed").map((event) => String(payloadOf(event).text)).join("\n");
  const last = payloadOf(turn.at(-1)!);
  const failed = turn.at(-1)!.type === "turn.interrupted" || last.outcome === "failed";
  const failure = failed ? String(last.reason ?? turn.at(-1)!.type).split("\n")[0] : undefined;
  return { tools: toolsOf(turn), answer, failure };
};

const textOf = (value: unknown): string => {
  if (typeof value === "string") return value;
  const content = (value as { content?: unknown } | undefined)?.content;
  if (Array.isArray(content)) return content.map((part) => typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("\n");
  return JSON.stringify(value ?? null);
};

/** Der Werkzeugaufruf eines Programmschritts; fehlt er, nennt die Meldung die Antwort des Skriptmodells. */
const stepOf = (turn: TurnResult, index: number, tool: string): ToolOutcome => {
  const outcome = turn.tools[index];
  expect(outcome, `Der Schritt ${tool} kam nicht zur Ausführung; ${turn.failure ? `der Turn scheitert: ${turn.failure}` : `Antwort: ${turn.answer || "keine"}`}`);
  expect(outcome.name === tool, `An Stelle ${index + 1} steht ${outcome.name} statt ${tool}`);
  expect(outcome.done, `${tool} hat kein Ende im Journal`);
  return outcome;
};

const completedText = (outcome: ToolOutcome): string => {
  expect(outcome.error === undefined, `${outcome.name} scheitert: ${outcome.error}`);
  return textOf(outcome.output);
};

const filesNamed = (directory: string, name: string): readonly string[] => existsSync(directory)
  ? readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesNamed(full, name);
    return entry.name === name ? [full] : [];
  })
  : [];

const WRITTEN_FILE = "notizen/aus-dem-modell.txt";

/** Liegt nur im Ordner des Containers. */
export const CONTAINER_ONLY = "nur-im-container.txt";

/** Liegt mit --shared-path nur in der Kopie auf dem Server. */
export const SERVER_ONLY = "nur-auf-dem-server.txt";

const TYPESCRIPT_CWD = "const node = (globalThis as unknown as { process: { cwd(): string; platform: string } }).process;\n"
  + "return { cwd: node.cwd(), platform: node.platform };";

const toolProgram = (nonce: string): ScriptProgram => ({
  id: "werkzeuge",
  steps: [
    { tool: "bash", input: { command: "uname -s; hostname; pwd" } },
    { tool: "read", input: { path: "README.md" } },
    { tool: "write", input: { path: WRITTEN_FILE, content: `Vom Skriptmodell geschrieben: ${nonce}\n` } },
    { tool: "typescript_eval", input: { code: TYPESCRIPT_CWD } },
  ],
});

const checkRegistry = async (env: CheckEnvironment): Promise<boolean> => {
  const { report, users, container } = env;
  const registered = await report.check("Arbeitsplatz", "der Container meldet sich als Arbeitsplatz von alice an", async () => {
    const client = await waitFor(async () => (await users.alice.call(workspaceContracts.clients.list, {})).find((entry) => entry.id === container.clientId),
      180_000, "Die Anmeldung des Arbeitsplatzes").catch(async (error: unknown) => {
      throw new Error(`${messageOf(error)}; Ende des Container-Protokolls:\n${tail(await containerLogs(container.name))}`);
    });
    expect(client.platform === "linux", `Der Arbeitsplatz meldet die Plattform ${client.platform} statt linux`);
    expect(client.hostname === container.hostname, `Der Arbeitsplatz meldet den Rechner ${client.hostname} statt ${container.hostname}`);
    expect(client.hostname !== hostname(), "Der Arbeitsplatz meldet den Rechnernamen des Servers");
    expect(client.folders.length === 1 && client.folders[0] === env.folder, `Angeboten sind ${client.folders.join(", ")} statt ${env.folder}`);
    return passed(`${client.label}, ${client.platform}, Rechner ${client.hostname}, Ordner ${client.folders.join(", ")}`);
  });
  if (!registered) return false;
  for (const [name, rpc, note] of [["bob", users.bob, ""], ["admin", users.admin, " trotz runs.read.all"]] as const) {
    await report.check("Arbeitsplatz", `${name} sieht den Arbeitsplatz von alice nicht${note}`, async () => {
      const listed = await rpc.call(workspaceContracts.clients.list, {});
      expect(listed.length === 0, `${name} sieht ${listed.map((entry) => `${entry.label} (${entry.id})`).join(", ")}`);
      return passed("die Liste ist leer");
    });
  }
  await report.check("Arbeitsplatz", "bob kann keinen Run an den Arbeitsplatz von alice binden", () =>
    failsWith(users.bob.call(coreContracts.startOptions.select, { runId: randomUUID(), optionId: WORKSPACE_BINDING_OPTION_ID, value: clientBinding(env) }),
      "workspace-client-disconnected"));
  return true;
};

const checkBinding = (env: CheckEnvironment): Promise<true | undefined> =>
  env.report.check("Run", "alice bindet einen Run an den Ordner im Container", async () => {
    const state = await env.users.alice.call(coreContracts.startOptions.select, { runId: env.runId, optionId: WORKSPACE_BINDING_OPTION_ID, value: clientBinding(env) });
    const value = state.value as WorkspaceBinding;
    expect(value.kind === "client" && value.client === env.container.clientId && value.path === env.folder, `Gespeichert ist ${JSON.stringify(state.value)}`);
    return passed(`${value.label}: ${value.path}, Run ${env.runId.slice(0, 8)}`);
  });

const checkTools = async (env: CheckEnvironment): Promise<void> => {
  const { report } = env;
  const titles = ["bash läuft unter Linux im Container", "read liest die Datei aus dem Container", "write schreibt in den Container, nicht auf den Server",
    "typescript_eval arbeitet in einem Ordner des Servers", "der Prompt nennt die Plattform und den Ordner des Arbeitsplatzes", "der Arbeitsplatz protokolliert die Aufrufe"];
  // Scheitert der Turn nach einzelnen Werkzeugen, beurteilen die folgenden Prüfungen diese trotzdem.
  const finished: { turn?: TurnResult } = {};
  await report.check("Werkzeuge", "ein Auftrag mit bash, read, write und typescript_eval läuft durch", async () => {
    finished.turn = await runScript(env, "Prüfe die Werkzeuge im Arbeitsbereich.", toolProgram(env.nonce));
    const tools = finished.turn.tools.map((tool) => `${tool.name} ${tool.error === undefined ? "ok" : "scheitert"}`).join(", ") || "kein Werkzeugaufruf";
    expect(finished.turn.failure === undefined, `Der Turn scheitert (${tools}): ${finished.turn.failure}`);
    return passed(tools);
  });
  const turn = finished.turn;
  if (!turn || turn.tools.length === 0) {
    report.skip("Werkzeuge", titles, turn ? "der Turn endet vor dem ersten Werkzeugaufruf" : "der Auftrag endet nicht");
    return;
  }
  await report.check("Werkzeuge", titles[0]!, async () => {
    const lines = completedText(stepOf(turn, 0, "bash")).trim().split("\n");
    expect(lines[0] === "Linux", `uname -s meldet ${lines[0]}`);
    expect(lines[1] === env.container.hostname, `hostname meldet ${lines[1]} statt ${env.container.hostname}`);
    expect(lines[2] === env.folder, `pwd meldet ${lines[2]} statt ${env.folder}`);
    return passed(lines.join(", "));
  });
  await report.check("Werkzeuge", titles[1]!, async () => {
    const text = completedText(stepOf(turn, 1, "read"));
    expect(text.includes(env.nonce), `README.md trägt die Kennung ${env.nonce} nicht: ${text.slice(0, 200)}`);
    return passed(`README.md mit Kennung ${env.nonce}`);
  });
  await report.check("Werkzeuge", titles[2]!, async () => {
    completedText(stepOf(turn, 2, "write"));
    const inside = await containerExec(env.container.name, ["cat", path.join(env.folder, WRITTEN_FILE)]);
    expect(inside.code === 0 && inside.stdout.includes(env.nonce), `${WRITTEN_FILE} fehlt im Container oder trägt die Kennung nicht: ${inside.stderr.trim() || inside.stdout.trim()}`);
    const strays = filesNamed(env.dataDirectory, path.basename(WRITTEN_FILE));
    expect(strays.length === 0, `Die Datei liegt auch im Datenordner des Servers: ${strays.join(", ")}`);
    const onServer = env.serverCopy ? path.join(env.folder, WRITTEN_FILE) : env.folder;
    expect(!existsSync(onServer), `${onServer} gibt es jetzt auch auf dem Server`);
    return passed(`${path.join(env.folder, WRITTEN_FILE)} im Container, auf dem Server nicht`);
  });
  await report.check("Werkzeuge", titles[3]!, async () => {
    const outcome = stepOf(turn, 3, "typescript_eval");
    completedText(outcome);
    const result = (outcome.output as { result?: { cwd?: unknown; platform?: unknown } } | undefined)?.result;
    const cwd = result?.cwd;
    expect(typeof cwd === "string" && path.isAbsolute(cwd), `Das Snippet meldet kein Arbeitsverzeichnis: ${JSON.stringify(outcome.output)}`);
    expect(!cwd.startsWith(env.folder), `Das Snippet arbeitet im Ordner des Arbeitsplatzes ${cwd}`);
    expect(existsSync(cwd), `${cwd} gibt es auf dem Server nicht`);
    const data = realpathSync(env.dataDirectory);
    expect(realpathSync(cwd).startsWith(`${data}${path.sep}`), `${cwd} liegt nicht im Datenordner des Servers ${data}`);
    expect(result?.platform === process.platform, `Das Snippet läuft auf ${String(result?.platform)} statt auf ${process.platform}`);
    return passed(`${path.relative(data, realpathSync(cwd))} im Datenordner des Servers, Plattform ${String(result?.platform)}`);
  });
  await report.check("Werkzeuge", titles[4]!, async () => {
    const exchange = env.model.exchanges.find((entry) => entry.program === "werkzeuge" && entry.step === 0 && entry.offeredTools.length > 0);
    expect(exchange, "Das Skriptmodell hat die erste Anfrage des Koordinators zu diesem Auftrag nicht gesehen");
    const shell = /## Shell platform\n\n([^\n]*)/.exec(exchange.systemPrompt)?.[1] ?? "kein Kapitel Shell platform";
    expect(exchange.systemPrompt.includes("runs on Linux with the GNU userland"), `Der Systemprompt nennt Linux nicht als Plattform der Shell: ${shell.slice(0, 200)}`);
    expect(!exchange.systemPrompt.includes("runs on macOS"), "Der Systemprompt nennt macOS, die Plattform des Servers");
    expect(exchange.systemPrompt.includes(`\`${env.folder}\` on the workplace "${env.container.label}"`),
      `Der Systemprompt nennt ${env.folder} nicht als Ordner des Arbeitsplatzes ${env.container.label}`);
    expect(!exchange.systemPrompt.includes("Current working directory"), "Der Systemprompt nennt daneben ein rohes Arbeitsverzeichnis");
    const runtimeFolder = path.join("plugins", "ragents.workspace", "server");
    expect(!exchange.systemPrompt.includes(runtimeFolder), `Der Systemprompt nennt den Ordner der Laufzeit auf dem Server (${runtimeFolder})`);
    return passed(`Linux mit GNU-Werkzeugen, Arbeitsverzeichnis ${env.folder} auf ${env.container.label}`);
  });
  await report.check("Werkzeuge", titles[5]!, async () => {
    const logs = await containerLogs(env.container.name);
    const prefix = `== ${env.runId.slice(0, 8)} `;
    const missing = ["bash", "read", "write"].filter((tool) => !logs.split("\n").some((line) => line.startsWith(`${prefix}${tool} `) && line.endsWith(" ok")));
    expect(missing.length === 0, `Im Protokoll des Arbeitsplatzes fehlen ${missing.join(", ")}:\n${tail(logs)}`);
    return passed("bash, read und write stehen im Protokoll des Containers");
  });
};

const ATTACHED_FILE = "daten.bin";

/** Ein binärer Anhang landet im Ordner attachments des Arbeitsbereichs, also im Container; der Server legt ihn nicht bei sich ab. */
const checkAttachment = (env: CheckEnvironment): Promise<true | undefined> =>
  env.report.check("Werkzeuge", "ein binärer Anhang liegt im Container, wo bash ihn liest, nicht auf dem Server", async () => {
    const content = Buffer.concat([Buffer.from([0, 255, 0]), Buffer.from(`Anhang ${env.nonce}`)]);
    const turn = await runScript(env, "Lies den Anhang.", { id: "anhang", steps: [{ tool: "bash", input: { command: `tail -c +4 attachments/${ATTACHED_FILE}` } }] },
      [{ name: ATTACHED_FILE, mediaType: "application/octet-stream", data: content.toString("base64") }]);
    const text = completedText(stepOf(turn, 0, "bash"));
    expect(text.includes(`Anhang ${env.nonce}`), `bash liest den Anhang nicht aus dem Container: ${text.slice(0, 200)}`);
    const inside = await containerExec(env.container.name, ["test", "-f", path.join(env.folder, "attachments", ATTACHED_FILE)]);
    expect(inside.code === 0, `${ATTACHED_FILE} fehlt unter attachments im Container`);
    const strays = filesNamed(env.dataDirectory, ATTACHED_FILE);
    expect(strays.length === 0, `Der Anhang liegt auch im Datenordner des Servers: ${strays.join(", ")}`);
    const onServer = env.serverCopy ? path.join(env.folder, "attachments") : env.folder;
    expect(!existsSync(onServer), `${onServer} gibt es jetzt auch auf dem Server`);
    return passed(`attachments/${ATTACHED_FILE} im Container, auf dem Server nicht`);
  });

const PAGE_SERVER = "const [port, nonce] = process.argv.slice(1);"
  + " require(\"node:http\").createServer((request, response) => {"
  + " response.setHeader(\"content-type\", \"text/html; charset=utf-8\");"
  + " response.end(`<!doctype html><title>Prüfseite</title><h1>Nur im Container ${nonce}</h1>`);"
  + " }).listen(Number(port), \"127.0.0.1\");";

const PAGE_PROBE = "const [port, nonce] = process.argv.slice(1);"
  + " fetch(`http://127.0.0.1:${port}/`).then((response) => response.text())"
  + ".then((text) => process.exit(text.includes(nonce) ? 0 : 1), () => process.exit(1));";

/** Vorbereitet für die Browserprüfung im Executor: die Seite gibt es nur auf localhost im Container. */
const checkBrowser = async (env: CheckEnvironment, port: number): Promise<void> => {
  await env.report.check("Browser", "browser_open lädt eine Seite von localhost im Container", async () => {
    const started = await containerExec(env.container.name, ["node", "-e", PAGE_SERVER, String(port), env.nonce], { detach: true });
    expect(started.code === 0, `Die Prüfseite startet im Container nicht: ${started.stderr.trim()}`);
    await waitFor(async () => (await containerExec(env.container.name, ["node", "-e", PAGE_PROBE, String(port), env.nonce])).code === 0 ? true : undefined,
      20_000, "Die Prüfseite im Container");
    const url = `http://127.0.0.1:${port}/`;
    const turn = await runScript(env, "Öffne die Prüfseite.", { id: "browser", steps: [{ tool: "browser_open", input: { url } }] });
    const text = completedText(stepOf(turn, 0, "browser_open"));
    expect(text.includes(`Nur im Container ${env.nonce}`), `Der Browser zeigt nicht die Seite aus dem Container: ${text.slice(0, 300)}`);
    return passed(`${url} im Container geöffnet`);
  });
};

const checkFiles = async (env: CheckEnvironment): Promise<void> => {
  const { report, users } = env;
  const target = { runId: env.runId, root: "workspace" as const };
  await report.check("Dateien", "der Reiter listet den Ordner im Container", async () => {
    const listing = await users.alice.call(workspaceContracts.browse.list, { ...target, path: "" });
    const names = listing.entries.map((entry) => entry.name);
    expect(names.includes("README.md") && names.includes(CONTAINER_ONLY), `Gelistet sind ${names.join(", ") || "keine Einträge"}`);
    expect(!names.includes(SERVER_ONLY), `Gelistet ist ${SERVER_ONLY}, die Datei vom Server`);
    expect(listing.location.includes(env.folder), `Der Ort heißt ${listing.location}`);
    return passed(`${listing.location}: ${names.join(", ")}`);
  });
  await report.check("Dateien", "die Vorschau zeigt README.md aus dem Container", async () => {
    const preview = await users.alice.call(workspaceContracts.browse.preview, { ...target, path: "README.md" });
    expect(preview.previewable, `Keine Vorschau: ${preview.previewable ? "" : preview.reason}`);
    expect(preview.content.includes(env.nonce), `Die Vorschau trägt die Kennung nicht: ${preview.content.slice(0, 200)}`);
    return passed(`${preview.size} Byte mit Kennung ${env.nonce}`);
  });
  await report.check("Dateien", "eine Änderung im Container meldet der Kanal", async () => {
    const changes: number[] = [];
    const errors: string[] = [];
    const unsubscribe = users.alice.subscribe(workspaceContracts.channels.browse, target, () => changes.push(Date.now()), (message) => errors.push(message));
    try {
      const writes = await waitFor(async () => {
        expect(errors.length === 0, `Der Kanal meldet einen Fehler: ${errors.join("; ")}`);
        await writeContainerFile(env.container.name, path.join(env.folder, "aenderung.txt"), `${new Date().toISOString()}\n`);
        await sleep(1_000);
        return changes.length > 0 ? changes.length : undefined;
      }, 30_000, "Eine Änderungsmeldung", 0);
      return passed(`${writes} Meldung(en) nach Schreiben per docker exec`);
    } finally {
      unsubscribe();
    }
  });
};

const snapshotOf = async (env: CheckEnvironment): Promise<readonly RunProcess[]> =>
  (await env.users.alice.call(processesContracts.snapshot, { runId: env.runId })).processes;

/** Startet im Container einen Prozess mit dem Run-Marker und wartet, bis die Anzeige ihn führt. */
const markedContainerProcess = async (env: CheckEnvironment, seconds: string): Promise<RunProcess> => {
  const started = await containerExec(env.container.name, ["sleep", seconds], { detach: true, env: { RAGENTS_RUN_ID: env.runId } });
  expect(started.code === 0, `sleep ${seconds} startet im Container nicht: ${started.stderr.trim()}`);
  return waitFor(async () => (await snapshotOf(env)).find((entry) => entry.command === `sleep ${seconds}`), 20_000, `Der Prozess sleep ${seconds} in der Anzeige`);
};

const checkProcesses = async (env: CheckEnvironment): Promise<void> => {
  const { report } = env;
  const shown = await report.check("Prozesse", "ein markierter Prozess im Container erscheint, der auf dem Server nicht", async () => {
    const visible = await markedProcesses([`RAGENTS_RUN_ID=${env.runId}`]);
    expect(visible.some((other) => other.pid === env.decoyPid), `Der Vergleichsprozess ${env.decoyPid} ist auf dem Server nicht als markiert lesbar; der Vergleich wäre wirkungslos`);
    const entry = await markedContainerProcess(env, "3141");
    const all = await snapshotOf(env);
    expect(!all.some((other) => other.pid === env.decoyPid || other.command.includes("2718")), "Die Anzeige führt den markierten Prozess des Servers");
    const cmdline = await containerExec(env.container.name, ["cat", `/proc/${entry.pid}/cmdline`]);
    expect(cmdline.stdout.split("\0").join(" ").trim() === "sleep 3141", `PID ${entry.pid} ist im Container nicht sleep 3141`);
    return { value: entry, detail: `PID ${entry.pid} im Container (${entry.origin}), ${all.length} Prozess(e) in der Anzeige` };
  });
  if (!shown) {
    report.skip("Prozesse", ["Beenden wirkt im Container, nicht auf dem Server"], "der Prozess erscheint nicht");
    return;
  }
  await report.check("Prozesse", "Beenden wirkt im Container, nicht auf dem Server", async () => {
    await env.users.alice.call(processesContracts.stop, { runId: env.runId, processId: shown.id });
    await waitFor(async () => await containerProcessAlive(env.container.name, shown.pid) ? undefined : true, 15_000, "Das Ende des Prozesses im Container");
    expect(alive(env.decoyPid), "Der markierte Prozess auf dem Server wurde mit beendet");
    return passed(`PID ${shown.pid} im Container beendet, PID ${env.decoyPid} auf dem Server läuft weiter`);
  });
};

const checkRights = async (env: CheckEnvironment): Promise<void> => {
  const { report, users, runId } = env;
  await report.check("Rechte", "bob sieht den Run von alice nicht in der Liste", async () => {
    const sessions = await users.bob.call(coreContracts.sessions.list, {});
    expect(!sessions.some((session) => session.id === runId), "Der Run steht in der Liste von bob");
    return passed(`${sessions.length} Run(s) in der Liste von bob`);
  });
  await report.check("Rechte", "bob liest weder Journal noch Dateien noch Prozesse", async () => {
    for (const call of [
      () => users.bob.call(runContracts.events, { runId }),
      () => users.bob.call(workspaceContracts.browse.list, { runId, root: "workspace", path: "" }),
      () => users.bob.call(processesContracts.snapshot, { runId }),
    ]) await failsWith(call(), "run-not-found");
    return passed("dreimal run-not-found");
  });
  await report.check("Rechte", "admin sieht den Run und sein Journal", async () => {
    const sessions = await users.admin.call(coreContracts.sessions.list, {});
    expect(sessions.some((session) => session.id === runId), "Der Run fehlt in der Liste von admin");
    const events = await users.admin.call(runContracts.events, { runId });
    expect(events.length > 0, "Das Journal ist für admin leer");
    return passed(`${events.length} Ereignisse`);
  });
  await report.check("Rechte", "admin liest weder Dateien noch Prozesse des Arbeitsbereichs", async () => {
    for (const call of [
      () => users.admin.call(workspaceContracts.browse.list, { runId, root: "workspace", path: "" }),
      () => users.admin.call(workspaceContracts.browse.preview, { runId, root: "workspace", path: "README.md" }),
      () => users.admin.call(processesContracts.snapshot, { runId }),
    ]) await failsWith(call(), "run-workspace-owner-only");
    return passed("dreimal run-workspace-owner-only");
  });
  await report.check("Rechte", "admin darf nicht hineinschreiben", () =>
    failsWith(users.admin.call(coreContracts.chat.send, { runId, text: "Nachricht von admin" }), "run-owner-only"));
  await report.check("Rechte", "admin darf keinen Prozess des Runs beenden", () =>
    failsWith(users.admin.call(processesContracts.stop, { runId, processId: `1-${"0".repeat(64)}` }), "run-owner-only"));
};

const clientListed = async (env: CheckEnvironment): Promise<boolean> =>
  (await env.users.alice.call(workspaceContracts.clients.list, {})).some((entry) => entry.id === env.container.clientId);

const checkDisconnect = async (env: CheckEnvironment): Promise<void> => {
  const { report, container } = env;
  const titles = ["der Dateien-Reiter meldet workspace-client-disconnected", "ein Werkzeugaufruf scheitert an der Trennung",
    "nach dem Neustart meldet sich der Arbeitsplatz wieder an", "danach laufen Werkzeuge wieder im Container"];
  const gone = await report.check("Trennen", "docker stop nimmt den Arbeitsplatz aus der Registry", async () => {
    await stopContainer(container.name);
    await waitFor(async () => await clientListed(env) ? undefined : true, 30_000, "Das Verschwinden des Arbeitsplatzes");
    return passed("abgemeldet");
  });
  if (!gone) {
    report.skip("Trennen", titles, "der Arbeitsplatz ist nicht getrennt");
    return;
  }
  await report.check("Trennen", titles[0]!, () =>
    failsWith(env.users.alice.call(workspaceContracts.browse.list, { runId: env.runId, root: "workspace", path: "" }), "workspace-client-disconnected"));
  await report.check("Trennen", titles[1]!, async () => {
    const turn = await runScript(env, "Prüfe den getrennten Arbeitsplatz.", { id: "getrennt", steps: [{ tool: "bash", input: { command: "uname -s" } }] });
    const outcome = stepOf(turn, 0, "bash");
    expect(outcome.error !== undefined, `bash gelingt trotz Trennung: ${textOf(outcome.output)}`);
    expect(/nicht verbunden|Verbindung verloren/.test(outcome.error), `Unerwartete Ursache: ${outcome.error}`);
    return passed(outcome.error);
  });
  const back = await report.check("Trennen", titles[2]!, async () => {
    await restartContainer(container.name);
    await waitFor(async () => await clientListed(env) ? true : undefined, 180_000, "Die erneute Anmeldung").catch(async (error: unknown) => {
      throw new Error(`${messageOf(error)}; Ende des Container-Protokolls:\n${tail(await containerLogs(container.name))}`);
    });
    return passed("docker start, wieder angemeldet");
  });
  if (!back) {
    report.skip("Trennen", [titles[3]!], "der Arbeitsplatz meldet sich nicht wieder an");
    return;
  }
  await report.check("Trennen", titles[3]!, async () => {
    const turn = await runScript(env, "Prüfe den wieder verbundenen Arbeitsplatz.", { id: "wieder-da", steps: [{ tool: "bash", input: { command: "cat README.md; uname -s" } }] });
    const text = completedText(stepOf(turn, 0, "bash"));
    expect(text.includes(env.nonce) && text.includes("Linux"), `Unerwartete Ausgabe: ${text.slice(0, 200)}`);
    return passed("bash liest README.md im Container");
  });
};

/** Der Strom bricht, der Arbeitsplatz lebt weiter: ein Stopp in dieser Zeit wartet auf ihn und greift, sobald er wieder da ist. */
const checkStreamLoss = async (env: CheckEnvironment): Promise<void> => {
  const { report, container } = env;
  const titles = ["der Stopp während der Trennung gelingt, der Prozess im Container läuft noch", "mit dem Netz kommt der Arbeitsplatz zurück und der Stopp greift"];
  const started = await report.check("Strom weg", "ein markierter Prozess läuft, dann verliert der Container das Netz", async () => {
    const entry = await markedContainerProcess(env, "3143");
    await disconnectNetwork(container.name);
    return { value: entry, detail: `sleep 3143 (PID ${entry.pid}) im Container, Netz getrennt` };
  });
  if (!started) {
    report.skip("Strom weg", titles, "der Prozess oder die Trennung fehlt");
    return;
  }
  await report.check("Strom weg", titles[0]!, async () => {
    const begun = Date.now();
    await env.users.alice.call(coreContracts.chat.stop, { runId: env.runId });
    expect(await containerProcessAlive(container.name, started.pid), `PID ${started.pid} ist schon beendet, obwohl der Container kein Netz hat`);
    return passed(`ragents.chat.stop nach ${Math.round((Date.now() - begun) / 1000)} s, PID ${started.pid} läuft weiter`);
  });
  await report.check("Strom weg", titles[1]!, async () => {
    await connectNetwork(container.name);
    await waitFor(async () => await containerProcessAlive(container.name, started.pid) ? undefined : true, 150_000, `Das Ende von sleep 3143 nach der Rückkehr des Netzes`);
    await waitFor(async () => await clientListed(env) ? true : undefined, 60_000, "Die Anmeldung nach der Rückkehr des Netzes");
    return passed(`PID ${started.pid} beendet, Arbeitsplatz angemeldet`);
  });
};

/** Der Not-Aus stoppt den Run; beide Executoren räumen ab, der im Container und der des Servers, der die TypeScript-Plattform des Runs trägt. */
const checkRunStop = (env: CheckEnvironment): Promise<true | undefined> =>
  env.report.check("Stopp", "admin stoppt den Run; das räumt im Container und auf dem Server ab", async () => {
    const entry = await markedContainerProcess(env, "3142");
    expect(alive(env.decoyPid), `Der markierte Prozess ${env.decoyPid} auf dem Server war schon vor dem Stopp beendet`);
    await env.users.admin.call(coreContracts.chat.stop, { runId: env.runId });
    await waitFor(async () => await containerProcessAlive(env.container.name, entry.pid) ? undefined : true, 30_000, "Das Ende von sleep 3142 im Container");
    await waitFor(async () => alive(env.decoyPid) ? undefined : true, 15_000, `Das Ende des markierten Prozesses ${env.decoyPid} auf dem Server`);
    return passed(`ragents.chat.stop; sleep 3142 (PID ${entry.pid}) im Container und PID ${env.decoyPid} auf dem Server beendet`);
  });

const checkStopAll = (env: CheckEnvironment): Promise<true | undefined> =>
  env.report.check("Stopp", "admin darf den ganzen Run mit ragents.runs.stopAll stoppen", async () => {
    await env.users.admin.call(runContracts.stopAll, { runId: env.runId, commandId: randomUUID(), reason: "Prüflauf beendet" });
    return passed("gelingt");
  });

/** Die fachlichen Prüfungen in fester Reihenfolge; fehlt eine Voraussetzung, werden die abhängigen Prüfungen übersprungen. */
export const runChecks = async (env: CheckEnvironment): Promise<void> => {
  const areas = ["Run", "Werkzeuge", "Dateien", "Prozesse", "Rechte", "Stopp", "Trennen", "Strom weg"];
  if (!await checkRegistry(env)) {
    for (const area of areas) env.report.skip(area, ["alle Prüfungen"], "der Arbeitsplatz ist nicht angemeldet");
    return;
  }
  if (!await checkBinding(env)) {
    for (const area of areas.slice(1)) env.report.skip(area, ["alle Prüfungen"], "es gibt keinen gebundenen Run");
    return;
  }
  await checkTools(env);
  await checkAttachment(env);
  if (env.browserPort !== undefined) await checkBrowser(env, env.browserPort);
  await checkFiles(env);
  await checkProcesses(env);
  await checkRights(env);
  await checkRunStop(env);
  await checkDisconnect(env);
  await checkStreamLoss(env);
  await checkStopAll(env);
};
