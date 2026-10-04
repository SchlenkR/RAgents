import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { coreContracts, runContracts } from "../../apps/server/src/api/contracts.ts";
import type { RpcClient } from "../../apps/web/src/rpc/client.ts";
import type { JournalEvent } from "../../packages/ragents/src/domain/events.ts";
import { processesContracts, type RunProcess } from "../../plugins/ragents.processes/contract.ts";
import { TUNNEL_END, bytesOf, openTunnelLeg, tunnelAddress } from "../../packages/workspace-executor/src/processes/tunnel.ts";
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
  /** The server's address on this machine; the container reaches it under another one. */
  readonly serverUrl: string;
  readonly model: ScriptModel;
  readonly dataDirectory: string;
  /** The server's SKILLS_DIR with the skill CHECK_SKILL and a file next to it. */
  readonly skillsDirectory: string;
  readonly container: ContainerTarget;
  /** The folder that the workspace in the container offers. */
  readonly folder: string;
  /** With --shared-path the same path also exists on the server, with different content; otherwise it does not exist there. */
  readonly serverCopy: boolean;
  /** The run of alice with binding to the folder in the container. */
  readonly runId: string;
  /** Appears in README.md in the container and nowhere else. */
  readonly nonce: string;
  /** A process on this machine with the run marker; it must be neither shown nor ended. */
  readonly decoyPid: number;
  /** With --browser the port of the check page on localhost in the container. */
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
    if (Date.now() - started > timeoutMs) throw new Error(`${what} is still missing after ${Math.round(timeoutMs / 1000)} s`);
    await sleep(intervalMs);
  }
};

const domainCodeOf = (error: unknown): string | undefined => {
  const code = (error as { data?: { code?: unknown } } | undefined)?.data?.code;
  return typeof code === "string" ? code : undefined;
};

/** The call must fail with exactly this domain error code. */
const failsWith = async (call: Promise<unknown>, code: string): Promise<Checked<true>> => {
  const outcome = await call.then(() => ({ failed: false as const }), (error: unknown) => ({ failed: true as const, error }));
  expect(outcome.failed, `The call succeeds; expected was ${code}`);
  const actual = domainCodeOf(outcome.error);
  expect(actual === code, `Expected was ${code}, reported is ${actual ?? "no code"}: ${messageOf(outcome.error)}`);
  return passed(`${code}: ${messageOf(outcome.error)}`);
};

const clientBinding = (env: CheckEnvironment): WorkspaceBinding =>
  ({ machine: { client: env.container.clientId, label: env.container.label }, folder: { path: env.folder } });

interface ToolOutcome {
  readonly name: string;
  readonly output: unknown;
  readonly error: string | undefined;
  readonly done: boolean;
}

interface TurnResult {
  readonly tools: readonly ToolOutcome[];
  readonly answer: string;
  /** The first line of the reason if the turn failed. */
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

/** Sends a task from alice with a program for the script model and waits for the end of the turn it triggers. */
const runScript = async (env: CheckEnvironment, text: string, program: ScriptProgram, attachments: readonly Attachment[] = []): Promise<TurnResult> => {
  const timeoutMs = 60_000;
  const { alice } = env.users;
  const before = (await eventsOf(alice, env.runId).catch(() => [])).length;
  const sending: { error?: unknown } = {};
  void alice.call(coreContracts.chat.send, { runId: env.runId, text: scriptedMessage(text, program), ...(attachments.length > 0 ? { attachments: [...attachments] } : {}) })
    .catch((error: unknown) => { sending.error = error ?? new Error("without reason"); });
  const turn = await waitFor(async () => {
    if (sending.error !== undefined) throw new Error(`ragents.chat.send fails: ${messageOf(sending.error)}`);
    const fresh = (await eventsOf(alice, env.runId).catch(() => [])).slice(before);
    const started = fresh.find((event) => event.type === "turn.started");
    if (!started) return undefined;
    const end = fresh.findIndex((event) => (event.type === "turn.finished" || event.type === "turn.interrupted")
      && payloadOf(event).turnId === payloadOf(started).turnId);
    return end < 0 ? undefined : fresh.slice(0, end + 1);
  }, timeoutMs, `The end of the turn for program ${program.id}`, 300);
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

/** The tool call of a program step; if it is missing, the message names the script model's answer. */
const stepOf = (turn: TurnResult, index: number, tool: string): ToolOutcome => {
  const outcome = turn.tools[index];
  expect(outcome, `The step ${tool} was not executed; ${turn.failure ? `the turn fails: ${turn.failure}` : `answer: ${turn.answer || "none"}`}`);
  expect(outcome.name === tool, `Position ${index + 1} holds ${outcome.name} instead of ${tool}`);
  expect(outcome.done, `${tool} has no end in the journal`);
  return outcome;
};

const completedText = (outcome: ToolOutcome): string => {
  expect(outcome.error === undefined, `${outcome.name} fails: ${outcome.error}`);
  return textOf(outcome.output);
};

const filesNamed = (directory: string, name: string): readonly string[] => existsSync(directory)
  ? readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesNamed(full, name);
    return entry.name === name ? [full] : [];
  })
  : [];

const WRITTEN_FILE = "notes/from-the-model.txt";

/** Exists only in the container's folder. */
export const CONTAINER_ONLY = "container-only.txt";

/** With --shared-path exists only in the copy on the server. */
export const SERVER_ONLY = "server-only.txt";

const TYPESCRIPT_CWD = "const node = (globalThis as unknown as { process: { cwd(): string; platform: string } }).process;\n"
  + "return { cwd: node.cwd(), platform: node.platform };";

const toolProgram = (nonce: string): ScriptProgram => ({
  id: "tools",
  steps: [
    { tool: "bash", input: { command: "uname -s; hostname; pwd" } },
    { tool: "read", input: { file_path: "README.md" } },
    { tool: "write", input: { file_path: WRITTEN_FILE, content: `Written by the script model: ${nonce}\n` } },
    { tool: "typescript_eval", input: { code: TYPESCRIPT_CWD } },
  ],
});

const checkRegistry = async (env: CheckEnvironment): Promise<boolean> => {
  const { report, users, container } = env;
  const registered = await report.check("Workspace", "the container registers as a workspace of alice", async () => {
    const client = await waitFor(async () => (await users.alice.call(workspaceContracts.clients.list, {})).find((entry) => entry.id === container.clientId),
      180_000, "The workspace's registration").catch(async (error: unknown) => {
      throw new Error(`${messageOf(error)}; end of the container log:\n${tail(await containerLogs(container.name))}`);
    });
    expect(client.platform === "linux", `The workspace reports the platform ${client.platform} instead of linux`);
    expect(client.hostname === container.hostname, `The workspace reports the machine ${client.hostname} instead of ${container.hostname}`);
    expect(client.hostname !== hostname(), "The workspace reports the server's machine name");
    expect(client.folders.length === 1 && client.folders[0] === env.folder, `Offered are ${client.folders.join(", ")} instead of ${env.folder}`);
    return passed(`${client.label}, ${client.platform}, machine ${client.hostname}, folder ${client.folders.join(", ")}`);
  });
  if (!registered) return false;
  for (const [name, rpc, note] of [["bob", users.bob, ""], ["admin", users.admin, " despite runs.read.all"]] as const) {
    await report.check("Workspace", `${name} does not see the workspace of alice${note}`, async () => {
      const listed = await rpc.call(workspaceContracts.clients.list, {});
      expect(listed.length === 0, `${name} sees ${listed.map((entry) => `${entry.label} (${entry.id})`).join(", ")}`);
      return passed("the list is empty");
    });
  }
  await report.check("Workspace", "bob cannot bind a run to the workspace of alice", () =>
    failsWith(users.bob.call(coreContracts.startOptions.select, { runId: randomUUID(), optionId: WORKSPACE_BINDING_OPTION_ID, value: clientBinding(env) }),
      "workspace-client-disconnected"));
  return true;
};

const checkBinding = (env: CheckEnvironment): Promise<true | undefined> =>
  env.report.check("Run", "alice binds a run to the folder in the container", async () => {
    const state = await env.users.alice.call(coreContracts.startOptions.select, { runId: env.runId, optionId: WORKSPACE_BINDING_OPTION_ID, value: clientBinding(env) });
    const { machine, folder } = state.value as WorkspaceBinding;
    expect(machine !== "server" && machine.client === env.container.clientId && folder !== "fresh" && !("fresh" in folder) && folder.path === env.folder,
      `Stored is ${JSON.stringify(state.value)}`);
    return passed(`${machine.label}: ${folder.path}, Run ${env.runId.slice(0, 8)}`);
  });

const checkTools = async (env: CheckEnvironment): Promise<void> => {
  const { report } = env;
  const titles = ["bash runs on Linux in the container", "read reads the file from the container", "write writes into the container, not onto the server",
    "typescript_eval works in a folder of the server", "the prompt names the workspace's platform and folder", "the workspace logs the calls"];
  // If the turn fails after some tools, the following checks still assess them.
  const finished: { turn?: TurnResult } = {};
  await report.check("Tools", "a task with bash, read, write and typescript_eval runs through", async () => {
    finished.turn = await runScript(env, "Check the tools in the workspace.", toolProgram(env.nonce));
    const tools = finished.turn.tools.map((tool) => `${tool.name} ${tool.error === undefined ? "ok" : "fails"}`).join(", ") || "no tool call";
    expect(finished.turn.failure === undefined, `The turn fails (${tools}): ${finished.turn.failure}`);
    return passed(tools);
  });
  const turn = finished.turn;
  if (!turn || turn.tools.length === 0) {
    report.skip("Tools", titles, turn ? "the turn ends before the first tool call" : "the task does not end");
    return;
  }
  await report.check("Tools", titles[0]!, async () => {
    const lines = completedText(stepOf(turn, 0, "bash")).trim().split("\n");
    expect(lines[0] === "Linux", `uname -s reports ${lines[0]}`);
    expect(lines[1] === env.container.hostname, `hostname reports ${lines[1]} instead of ${env.container.hostname}`);
    expect(lines[2] === env.folder, `pwd reports ${lines[2]} instead of ${env.folder}`);
    return passed(lines.join(", "));
  });
  await report.check("Tools", titles[1]!, async () => {
    const text = completedText(stepOf(turn, 1, "read"));
    expect(text.includes(env.nonce), `README.md does not carry the nonce ${env.nonce}: ${text.slice(0, 200)}`);
    return passed(`README.md with nonce ${env.nonce}`);
  });
  await report.check("Tools", titles[2]!, async () => {
    completedText(stepOf(turn, 2, "write"));
    const inside = await containerExec(env.container.name, ["cat", path.join(env.folder, WRITTEN_FILE)]);
    expect(inside.code === 0 && inside.stdout.includes(env.nonce), `${WRITTEN_FILE} is missing in the container or does not carry the nonce: ${inside.stderr.trim() || inside.stdout.trim()}`);
    const strays = filesNamed(env.dataDirectory, path.basename(WRITTEN_FILE));
    expect(strays.length === 0, `The file is also in the server's data folder: ${strays.join(", ")}`);
    const onServer = env.serverCopy ? path.join(env.folder, WRITTEN_FILE) : env.folder;
    expect(!existsSync(onServer), `${onServer} now also exists on the server`);
    return passed(`${path.join(env.folder, WRITTEN_FILE)} in the container, not on the server`);
  });
  await report.check("Tools", titles[3]!, async () => {
    const outcome = stepOf(turn, 3, "typescript_eval");
    completedText(outcome);
    const result = (outcome.output as { result?: { cwd?: unknown; platform?: unknown } } | undefined)?.result;
    const cwd = result?.cwd;
    expect(typeof cwd === "string" && path.isAbsolute(cwd), `The snippet reports no working directory: ${JSON.stringify(outcome.output)}`);
    expect(!cwd.startsWith(env.folder), `The snippet works in the workspace's folder ${cwd}`);
    expect(existsSync(cwd), `${cwd} does not exist on the server`);
    const data = realpathSync(env.dataDirectory);
    expect(realpathSync(cwd).startsWith(`${data}${path.sep}`), `${cwd} is not in the server's data folder ${data}`);
    expect(result?.platform === process.platform, `The snippet runs on ${String(result?.platform)} instead of ${process.platform}`);
    return passed(`${path.relative(data, realpathSync(cwd))} in the server's data folder, platform ${String(result?.platform)}`);
  });
  await report.check("Tools", titles[4]!, async () => {
    const exchange = env.model.exchanges.find((entry) => entry.program === "tools" && entry.step === 0 && entry.offeredTools.length > 0);
    expect(exchange, "The script model did not see the coordinator's first request for this task");
    const shell = /## Shell platform\n\n([^\n]*)/.exec(exchange.systemPrompt)?.[1] ?? "no chapter Shell platform";
    expect(exchange.systemPrompt.includes("runs on Linux with the GNU userland"), `The system prompt does not name Linux as the shell's platform: ${shell.slice(0, 200)}`);
    expect(!exchange.systemPrompt.includes("runs on macOS"), "The system prompt names macOS, the server's platform");
    expect(exchange.systemPrompt.includes(`\`${env.folder}\` on the workstation "${env.container.label}"`),
      `The system prompt does not name ${env.folder} as the folder of the workspace ${env.container.label}`);
    expect(!exchange.systemPrompt.includes("Current working directory"), "The system prompt also names a raw working directory");
    const runtimeFolder = path.join("plugins", "ragents.workspace", "server");
    expect(!exchange.systemPrompt.includes(runtimeFolder), `The system prompt names the runtime's folder on the server (${runtimeFolder})`);
    return passed(`Linux with GNU tools, working directory ${env.folder} on ${env.container.label}`);
  });
  await report.check("Tools", titles[5]!, async () => {
    const logs = await containerLogs(env.container.name);
    const prefix = `== ${env.runId.slice(0, 8)} `;
    const missing = ["bash", "read", "write"].filter((tool) => !logs.split("\n").some((line) => line.startsWith(`${prefix}${tool} `) && line.endsWith(" ok")));
    expect(missing.length === 0, `The workspace's log is missing ${missing.join(", ")}:\n${tail(logs)}`);
    return passed("bash, read and write are in the container's log");
  });
};

/** The check profile's skill; the runner puts it with a template next to it into the server's SKILLS_DIR. */
export const CHECK_SKILL = "check-notes";

const PROGRAM = "check-counter";

/** The domain test passes only after editing, so activating proves that edit took effect on the server. */
const programFiles = (nonce: string): Readonly<Record<string, string>> => ({
  "package.json": JSON.stringify({ name: PROGRAM, type: "module", private: true, ragents: { title: "Check counter", backend: "src/server.ts" } }),
  "src/server.ts": `import { Type } from "typebox";
import { defineActor } from "@ragents/server";
export default defineActor({ state: Type.Object({}), functions: {
  nonce: { label: "Nonce", input: Type.Object({}), output: Type.String(), tool: { name: "check_nonce" } },
} }, { functions: { nonce: () => "before" } });
`,
  "tests/nonce.test.ts": `import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import program from "../src/server.ts";
test("nonce", async () => {
  assert.equal(await program.functions.nonce({}, createTestContext({ state: {} })), ${JSON.stringify(nonce)});
});
`,
});

const PROBE = 'uname -s; hostname; pwd; echo "[${RAGENTS_ACTORS_DIR:-}]"';

/** The tools the script model calls itself; the functions a snippet calls appear in between in the journal. */
const MODEL_TOOLS: readonly string[] = ["typescript_eval", "read", "write", "edit", "bash"];

const programSteps = (nonce: string): ScriptProgram => ({
  id: "actor-program",
  steps: [
    { tool: "typescript_eval", input: { code: `return context.functions.actor_program_create({ name: ${JSON.stringify(PROGRAM)}, template: "blank" });` } },
    // The template wrote package.json, and write replaces only a file the model has read.
    { tool: "read", input: { file_path: `@actors/${PROGRAM}/package.json` } },
    ...Object.entries(programFiles(nonce)).map(([file, content]) => ({ tool: "write", input: { file_path: `@actors/${PROGRAM}/${file}`, content } })),
    { tool: "edit", input: { file_path: `@actors/${PROGRAM}/src/server.ts`, old_string: '() => "before"', new_string: `() => ${JSON.stringify(nonce)}` } },
    { tool: "bash", input: { command: PROBE, cwd: `@actors/${PROGRAM}` } },
    { tool: "bash", input: { command: PROBE } },
    { tool: "typescript_eval", input: { code: `return context.functions.actor_program_activate({ name: ${JSON.stringify(PROGRAM)} });` } },
    { tool: "typescript_eval", input: { code: "return context.functions.check_nonce({});" } },
  ],
});

const skillSteps: ScriptProgram = {
  id: "skill",
  steps: [
    { tool: "read", input: { file_path: `@skills/${CHECK_SKILL}/SKILL.md` } },
    { tool: "read", input: { file_path: `@skills/${CHECK_SKILL}/template.md` } },
    { tool: "bash", input: { command: "cat template.md; uname -s", cwd: `@skills/${CHECK_SKILL}` } },
  ],
};

const serverPlatform = (): string => ({ darwin: "Darwin", linux: "Linux" } as Readonly<Record<string, string>>)[process.platform] ?? process.platform;

/** Another run of alice on the folder in the container: actor programs and skills live on the server and are reachable anyway. */
const checkServerRoots = async (env: CheckEnvironment): Promise<void> => {
  const { report, users, container } = env;
  const run = { ...env, runId: randomUUID() };
  const programTitles = ["creating, editing and activating run on the server, none of it in the container",
    "bash with @actors as cwd runs on the server and knows RAGENTS_ACTORS_DIR, without cwd in the container without the variable"];
  const skillTitles = ["read and bash reach the skill folder on the server", "the prompt names @skills and the server's roots, no path and no variable in the container"];
  const bound = await report.check("Roots", "alice binds another run to the folder in the container", async () => {
    await users.alice.call(coreContracts.startOptions.select, { runId: run.runId, optionId: WORKSPACE_BINDING_OPTION_ID, value: clientBinding(env) });
    return passed(`Run ${run.runId.slice(0, 8)}`);
  });
  if (!bound) {
    report.skip("Roots", [...programTitles, ...skillTitles], "there is no run for it");
    return;
  }
  const programTurn = await report.check("Roots", "an actor program is created, edited and activated", async () => {
    const all = await runScript(run, "Build the check program.", programSteps(env.nonce));
    const turn = { ...all, tools: all.tools.filter((tool) => MODEL_TOOLS.includes(tool.name)) };
    const tools = all.tools.map((tool) => `${tool.name} ${tool.error === undefined ? "ok" : `fails: ${tool.error}`}`).join(", ");
    expect(all.failure === undefined && turn.tools.length === 10 && all.tools.every((tool) => tool.done && tool.error === undefined), `The turn does not end cleanly (${tools}): ${all.failure ?? "without error"}`);
    const activated = (turn.tools[8]!.output as { result?: unknown } | undefined)?.result;
    expect(JSON.stringify(activated) === JSON.stringify({ name: PROGRAM, actor: `@${PROGRAM}`, views: 0, active: true }), `Activate reports ${JSON.stringify(activated)}`);
    const called = (turn.tools[9]!.output as { result?: unknown } | undefined)?.result;
    expect(called === env.nonce, `The program's function returns ${JSON.stringify(called)} instead of the nonce ${env.nonce}`);
    return { value: turn, detail: `${PROGRAM} activated, check_nonce returns the nonce` };
  });
  if (!programTurn) {
    report.skip("Roots", programTitles, "the program is not activated");
  } else {
    await report.check("Roots", programTitles[0]!, async () => {
      const onServer = filesNamed(env.dataDirectory, "nonce.test.ts").filter((file) => file.endsWith(path.join("actors", PROGRAM, "tests", "nonce.test.ts")));
      expect(onServer.length === 1, `The package is not exactly once in the server's store: ${onServer.join(", ") || "none"}`);
      const found = await containerExec(container.name, ["sh", "-c", `find / -xdev -name ${PROGRAM} -not -path '/proc/*' 2>/dev/null`]);
      expect(found.stdout.trim() === "", `The container holds ${found.stdout.trim()}`);
      const prefix = `== ${run.runId.slice(0, 8)} `;
      const called = (await containerLogs(container.name)).split("\n").filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length).split(" ")[0]);
      expect(called.join(",") === "bash", `The workspace logs ${called.join(", ") || "nothing"} for this run instead of exactly one bash without alias`);
      return passed(`${path.relative(env.dataDirectory, path.dirname(path.dirname(onServer[0]!)))} in the server's data folder; in the container only the bash without alias`);
    });
    await report.check("Roots", programTitles[1]!, async () => {
      const [platform, host, folder, variable] = completedText(stepOf(programTurn, 6, "bash")).trim().split("\n");
      expect(platform === serverPlatform() && host === hostname(), `bash with @actors reports ${platform} on ${host} instead of ${serverPlatform()} on ${hostname()}`);
      const data = realpathSync(env.dataDirectory);
      expect(folder !== undefined && realpathSync(folder).startsWith(`${data}${path.sep}`) && folder.endsWith(`${path.sep}${PROGRAM}`), `pwd reports ${folder}`);
      expect(variable !== undefined && variable !== "[]" && realpathSync(variable.slice(1, -1)).startsWith(`${data}${path.sep}`), `RAGENTS_ACTORS_DIR is ${variable} there`);
      const [remotePlatform, remoteHost, remoteFolder, remoteVariable] = completedText(stepOf(programTurn, 7, "bash")).trim().split("\n");
      expect(remotePlatform === "Linux" && remoteHost === container.hostname && remoteFolder === env.folder, `bash without cwd reports ${remotePlatform} on ${remoteHost} in ${remoteFolder}`);
      expect(remoteVariable === "[]", `bash in the container knows RAGENTS_ACTORS_DIR: ${remoteVariable}`);
      return passed(`${platform} on ${host} in ${path.relative(data, realpathSync(folder))}, Linux in the container without variable`);
    });
  }
  const skillTurn = await report.check("Roots", `a task following the skill ${CHECK_SKILL} runs through`, async () => {
    const turn = await runScript(run, `Work according to the skill ${CHECK_SKILL} and read its template.`, skillSteps);
    expect(turn.failure === undefined, `The turn fails: ${turn.failure}`);
    return { value: turn, detail: turn.tools.map((tool) => `${tool.name} ${tool.error === undefined ? "ok" : "fails"}`).join(", ") };
  });
  if (!skillTurn) {
    report.skip("Roots", skillTitles, "the task does not end");
    return;
  }
  await report.check("Roots", skillTitles[0]!, async () => {
    expect(completedText(stepOf(skillTurn, 0, "read")).includes("Read template.md"), "read does not read the SKILL.md");
    expect(completedText(stepOf(skillTurn, 1, "read")).includes(env.nonce), "read does not read the template next to the SKILL.md");
    const listed = completedText(stepOf(skillTurn, 2, "bash"));
    expect(listed.includes(env.nonce) && listed.trim().endsWith(serverPlatform()), `bash in the skill folder reports ${listed.trim()}`);
    return passed(`SKILL.md and template.md through @skills/${CHECK_SKILL}, bash there on ${serverPlatform()}`);
  });
  await report.check("Roots", skillTitles[1]!, async () => {
    const exchange = env.model.exchanges.find((entry) => entry.program === "skill" && entry.step === 0 && entry.offeredTools.length > 0);
    expect(exchange, "The script model did not see the first request for the skill task");
    const prompt = exchange.systemPrompt;
    expect(prompt.includes(`<location>@skills/${CHECK_SKILL}/SKILL.md</location>`), "The catalog does not name the skill under @skills");
    expect(prompt.includes(`location="@skills/${CHECK_SKILL}/SKILL.md"`), "The preload does not name the skill under @skills");
    expect(!prompt.includes(env.skillsDirectory) && !prompt.includes(realpathSync(env.skillsDirectory)), "The prompt names the skills folder on the server");
    expect(prompt.includes("## Roots on the server"), "The prompt does not describe the server's roots");
    const mentions = prompt.match(/RAGENTS_ACTORS_DIR/g) ?? [];
    const roots = prompt.slice(prompt.indexOf("## Roots on the server")).split("\n## ")[0]!;
    const named = roots.split(/(?<=\.)\s+/).find((sentence) => sentence.includes("RAGENTS_ACTORS_DIR")) ?? "";
    expect(mentions.length === 1 && named.includes("runs on the server") && named.includes("`$RAGENTS_ACTORS_DIR` for `@actors`"),
      `The prompt names RAGENTS_ACTORS_DIR ${mentions.length} times, not once for @actors in the sentence about the bash on the server: ${named || "no such sentence"}`);
    return passed("catalog and preload under @skills, the server's roots, the variable only for the bash there");
  });
};

const FRESH_FILE = "new.txt";

/** The new folder per run is created in the container under the workspace's runs folder and disappears with the run. */
const checkFreshFolder = async (env: CheckEnvironment): Promise<void> => {
  const { report, users, container } = env;
  const run = { ...env, runId: randomUUID() };
  const titles = ["write and bash work in the new folder in the container, not on the server", "deleting the run removes the folder in the container"];
  const bound = await report.check("New folder", "alice binds a run to a new folder in the container", async () => {
    const state = await users.alice.call(coreContracts.startOptions.select, {
      runId: run.runId,
      optionId: WORKSPACE_BINDING_OPTION_ID,
      value: { machine: { client: container.clientId, label: container.label }, folder: "fresh" },
    });
    const { machine, folder } = state.value as WorkspaceBinding;
    expect(machine !== "server" && machine.client === container.clientId && folder !== "fresh" && "fresh" in folder
      && folder.path.endsWith(`/${run.runId}`), `Stored is ${JSON.stringify(state.value)}`);
    return { value: folder.path, detail: folder.path };
  });
  if (!bound) {
    report.skip("New folder", titles, "there is no run with a new folder");
    return;
  }
  await report.check("New folder", titles[0]!, async () => {
    const turn = await runScript(run, "Write into the new folder.", {
      id: "new-folder",
      steps: [{ tool: "write", input: { file_path: FRESH_FILE, content: `New ${env.nonce}\n` } }, { tool: "bash", input: { command: "pwd" } }],
    });
    completedText(stepOf(turn, 0, "write"));
    const pwd = completedText(stepOf(turn, 1, "bash")).trim().split("\n")[0];
    expect(pwd === bound, `pwd reports ${pwd} instead of ${bound}`);
    const inside = await containerExec(container.name, ["cat", path.posix.join(bound, FRESH_FILE)]);
    expect(inside.code === 0 && inside.stdout.includes(env.nonce), `${FRESH_FILE} is missing in the new folder in the container: ${inside.stderr.trim()}`);
    expect(!existsSync(bound), `${bound} also exists on the server`);
    return passed(`${path.posix.join(bound, FRESH_FILE)} in the container`);
  });
  await report.check("New folder", titles[1]!, async () => {
    await users.alice.call(coreContracts.runs.delete, { runId: run.runId });
    await waitFor(async () => (await containerExec(container.name, ["test", "-e", bound])).code !== 0 ? true : undefined,
      15_000, `The disappearance of ${bound} in the container`);
    return passed(`${bound} is gone`);
  });
};

const ATTACHED_FILE = "data.bin";

/** A binary attachment lands in the workspace's attachments folder, i.e. in the container; the server does not store it itself. */
const checkAttachment = (env: CheckEnvironment): Promise<true | undefined> =>
  env.report.check("Tools", "a binary attachment is in the container, where bash reads it, not on the server", async () => {
    const content = Buffer.concat([Buffer.from([0, 255, 0]), Buffer.from(`Attachment ${env.nonce}`)]);
    const turn = await runScript(env, "Read the attachment.", { id: "attachment", steps: [{ tool: "bash", input: { command: `tail -c +4 attachments/${ATTACHED_FILE}` } }] },
      [{ name: ATTACHED_FILE, mediaType: "application/octet-stream", data: content.toString("base64") }]);
    const text = completedText(stepOf(turn, 0, "bash"));
    expect(text.includes(`Attachment ${env.nonce}`), `bash does not read the attachment from the container: ${text.slice(0, 200)}`);
    const inside = await containerExec(env.container.name, ["test", "-f", path.join(env.folder, "attachments", ATTACHED_FILE)]);
    expect(inside.code === 0, `${ATTACHED_FILE} is missing under attachments in the container`);
    const strays = filesNamed(env.dataDirectory, ATTACHED_FILE);
    expect(strays.length === 0, `The attachment is also in the server's data folder: ${strays.join(", ")}`);
    const onServer = env.serverCopy ? path.join(env.folder, "attachments") : env.folder;
    expect(!existsSync(onServer), `${onServer} now also exists on the server`);
    return passed(`attachments/${ATTACHED_FILE} in the container, not on the server`);
  });

const PAGE_SERVER = "const [port, nonce] = process.argv.slice(1);"
  + " require(\"node:http\").createServer((request, response) => {"
  + " response.setHeader(\"content-type\", \"text/html; charset=utf-8\");"
  + " response.end(`<!doctype html><title>Check page</title><h1>Only in the container ${nonce}</h1>`);"
  + " }).listen(Number(port), \"127.0.0.1\");";

const PAGE_PROBE = "const [port, nonce] = process.argv.slice(1);"
  + " fetch(`http://127.0.0.1:${port}/`).then((response) => response.text())"
  + ".then((text) => process.exit(text.includes(nonce) ? 0 : 1), () => process.exit(1));";

/** Prepared for the browser check in the executor: the page exists only on localhost in the container. */
const checkBrowser = async (env: CheckEnvironment, port: number): Promise<void> => {
  await env.report.check("Browser", "browser_navigate loads a page from localhost in the container", async () => {
    const started = await containerExec(env.container.name, ["node", "-e", PAGE_SERVER, String(port), env.nonce], { detach: true });
    expect(started.code === 0, `The check page does not start in the container: ${started.stderr.trim()}`);
    await waitFor(async () => (await containerExec(env.container.name, ["node", "-e", PAGE_PROBE, String(port), env.nonce])).code === 0 ? true : undefined,
      20_000, "The check page in the container");
    const url = `http://127.0.0.1:${port}/`;
    const turn = await runScript(env, "Open the check page.", { id: "browser", steps: [{ tool: "browser_navigate", input: { url } }] });
    const text = completedText(stepOf(turn, 0, "browser_navigate"));
    expect(text.includes(`Only in the container ${env.nonce}`), `The browser does not show the page from the container: ${text.slice(0, 300)}`);
    return passed(`${url} opened in the container`);
  });
};

const checkFiles = async (env: CheckEnvironment): Promise<void> => {
  const { report, users } = env;
  const target = { runId: env.runId, root: "workspace" as const };
  await report.check("Files", "the tab lists the folder in the container", async () => {
    const listing = await users.alice.call(workspaceContracts.browse.list, { ...target, path: "" });
    const names = listing.entries.map((entry) => entry.name);
    expect(names.includes("README.md") && names.includes(CONTAINER_ONLY), `Listed are ${names.join(", ") || "no entries"}`);
    expect(!names.includes(SERVER_ONLY), `Listed is ${SERVER_ONLY}, the file from the server`);
    expect(listing.location.includes(env.folder), `The location is ${listing.location}`);
    return passed(`${listing.location}: ${names.join(", ")}`);
  });
  await report.check("Files", "the preview shows README.md from the container", async () => {
    const preview = await users.alice.call(workspaceContracts.browse.preview, { ...target, path: "README.md" });
    expect(preview.previewable, `No preview: ${preview.previewable ? "" : preview.reason}`);
    expect(preview.content.includes(env.nonce), `The preview does not carry the nonce: ${preview.content.slice(0, 200)}`);
    return passed(`${preview.size} bytes with nonce ${env.nonce}`);
  });
  await report.check("Files", "the channel reports a change in the container", async () => {
    const changes: number[] = [];
    const errors: string[] = [];
    const unsubscribe = users.alice.subscribe(workspaceContracts.channels.browse, target, () => changes.push(Date.now()), (message) => errors.push(message));
    try {
      const writes = await waitFor(async () => {
        expect(errors.length === 0, `The channel reports an error: ${errors.join("; ")}`);
        await writeContainerFile(env.container.name, path.join(env.folder, "change.txt"), `${new Date().toISOString()}\n`);
        await sleep(1_000);
        return changes.length > 0 ? changes.length : undefined;
      }, 30_000, "A change notification", 0);
      return passed(`${writes} notification(s) after writing via docker exec`);
    } finally {
      unsubscribe();
    }
  });
};

const snapshotOf = async (env: CheckEnvironment): Promise<readonly RunProcess[]> =>
  (await env.users.alice.call(processesContracts.snapshot, { runId: env.runId })).processes;

/** Starts a process with the run marker in the container and waits until the display lists it. */
const markedContainerProcess = async (env: CheckEnvironment, seconds: string): Promise<RunProcess> => {
  const started = await containerExec(env.container.name, ["sleep", seconds], { detach: true, env: { RAGENTS_RUN_ID: env.runId } });
  expect(started.code === 0, `sleep ${seconds} does not start in the container: ${started.stderr.trim()}`);
  return waitFor(async () => (await snapshotOf(env)).find((entry) => entry.command === `sleep ${seconds}`), 20_000, `The process sleep ${seconds} in the display`);
};

const checkProcesses = async (env: CheckEnvironment): Promise<void> => {
  const { report } = env;
  const shown = await report.check("Processes", "a marked process in the container appears, the one on the server does not", async () => {
    const visible = await markedProcesses([`RAGENTS_RUN_ID=${env.runId}`]);
    expect(visible.some((other) => other.pid === env.decoyPid), `The decoy process ${env.decoyPid} is not readable as marked on the server; the comparison would be ineffective`);
    const entry = await markedContainerProcess(env, "3141");
    const all = await snapshotOf(env);
    expect(!all.some((other) => other.pid === env.decoyPid || other.command.includes("2718")), "The display lists the server's marked process");
    const cmdline = await containerExec(env.container.name, ["cat", `/proc/${entry.pid}/cmdline`]);
    expect(cmdline.stdout.split("\0").join(" ").trim() === "sleep 3141", `PID ${entry.pid} in the container is not sleep 3141`);
    return { value: entry, detail: `PID ${entry.pid} in the container (${entry.origin}), ${all.length} process(es) in the display` };
  });
  if (!shown) {
    report.skip("Processes", ["ending takes effect in the container, not on the server"], "the process does not appear");
    return;
  }
  await report.check("Processes", "ending takes effect in the container, not on the server", async () => {
    await env.users.alice.call(processesContracts.stop, { runId: env.runId, processId: shown.id });
    await waitFor(async () => await containerProcessAlive(env.container.name, shown.pid) ? undefined : true, 15_000, "The end of the process in the container");
    expect(alive(env.decoyPid), "The marked process on the server was ended as well");
    return passed(`PID ${shown.pid} in the container ended, PID ${env.decoyPid} on the server keeps running`);
  });
};

const ECHO_SERVICE = "require(\"node:net\").createServer({ allowHalfOpen: true }, (socket) => socket.pipe(socket)).listen(0, \"127.0.0.1\");"
  + " setTimeout(() => {}, 3144 * 1000);";

/** A service in the container streams through the server: the container's workstation dials back, this machine is the caller. */
const checkServices = async (env: CheckEnvironment): Promise<void> => {
  const { report, users, runId } = env;
  const titles = ["a stream carries bytes both ways through the server and ends normally", "bob and admin open no stream to it"];
  const service = await report.check("Services", "an echo service in the container appears with its port", async () => {
    const started = await containerExec(env.container.name, ["node", "-e", ECHO_SERVICE, "echo-service-3144"], { detach: true, env: { RAGENTS_RUN_ID: runId } });
    expect(started.code === 0, `The echo service does not start in the container: ${started.stderr.trim()}`);
    const entry = await waitFor(async () => (await snapshotOf(env)).find((process) => process.command.includes("echo-service-3144") && process.ports.length > 0),
      20_000, "The echo service with its port in the display");
    return { value: entry, detail: `PID ${entry.pid}, port ${entry.ports[0]!.port} in the container` };
  });
  if (!service) {
    report.skip("Services", titles, "the service does not appear");
    return;
  }
  const port = service.ports[0]!.port;
  await report.check("Services", titles[0]!, async () => {
    const opened = await users.alice.call(processesContracts.tunnel, { runId, port, connect: true });
    expect(opened !== null, "The tunnel method opened no stream");
    const leg = await openTunnelLeg(tunnelAddress(env.serverUrl, opened.path));
    const echoed: Buffer[] = [];
    const ended: string[] = [];
    const closed = new Promise<number>((resolve) => leg.on("close", (code) => resolve(code)));
    leg.on("message", (data, binary) => {
      if (binary) echoed.push(bytesOf(data));
      else ended.push(bytesOf(data).toString("utf8"));
    });
    leg.resume();
    const sent = Buffer.from(`Through the server ${env.nonce} \u0000\u00ff`, "latin1");
    leg.send(sent, { binary: true });
    await waitFor(async () => Buffer.concat(echoed).length >= sent.length ? true : undefined, 15_000, "The echo through the stream", 50);
    expect(Buffer.concat(echoed).equals(sent), `The echo differs: ${Buffer.concat(echoed).toString("latin1")}`);
    leg.send(TUNNEL_END);
    const code = await Promise.race([closed, sleep(15_000).then(() => 0)]);
    expect(ended.join() === TUNNEL_END && code === 1000, `The stream ended with ${JSON.stringify(ended)} and code ${code}`);
    return passed(`${sent.length} bytes from port ${port} in the container echoed through the server, closed with 1000`);
  });
  await report.check("Services", titles[1]!, async () => {
    await failsWith(users.bob.call(processesContracts.tunnel, { runId, port, connect: true }), "run-not-found");
    await failsWith(users.admin.call(processesContracts.tunnel, { runId, port, connect: true }), "run-workspace-owner-only");
    return passed("run-not-found for bob, run-workspace-owner-only for admin");
  });
  await users.alice.call(processesContracts.stop, { runId, processId: service.id });
};

const checkRights = async (env: CheckEnvironment): Promise<void> => {
  const { report, users, runId } = env;
  await report.check("Rights", "bob does not see the run of alice in the list", async () => {
    const sessions = await users.bob.call(coreContracts.runs.list, {});
    expect(!sessions.some((session) => session.id === runId), "The run is in bob's list");
    return passed(`${sessions.length} run(s) in bob's list`);
  });
  await report.check("Rights", "bob reads neither journal nor files nor processes", async () => {
    for (const call of [
      () => users.bob.call(runContracts.events, { runId }),
      () => users.bob.call(workspaceContracts.browse.list, { runId, root: "workspace", path: "" }),
      () => users.bob.call(processesContracts.snapshot, { runId }),
    ]) await failsWith(call(), "run-not-found");
    return passed("three times run-not-found");
  });
  await report.check("Rights", "admin sees the run and its journal", async () => {
    const sessions = await users.admin.call(coreContracts.runs.list, {});
    expect(sessions.some((session) => session.id === runId), "The run is missing in admin's list");
    const events = await users.admin.call(runContracts.events, { runId });
    expect(events.length > 0, "The journal is empty for admin");
    return passed(`${events.length} events`);
  });
  await report.check("Rights", "admin reads neither files nor processes of the workspace", async () => {
    for (const call of [
      () => users.admin.call(workspaceContracts.browse.list, { runId, root: "workspace", path: "" }),
      () => users.admin.call(workspaceContracts.browse.preview, { runId, root: "workspace", path: "README.md" }),
      () => users.admin.call(processesContracts.snapshot, { runId }),
    ]) await failsWith(call(), "run-workspace-owner-only");
    return passed("three times run-workspace-owner-only");
  });
  await report.check("Rights", "admin must not write into it", () =>
    failsWith(users.admin.call(coreContracts.chat.send, { runId, text: "Message from admin" }), "run-owner-only"));
  await report.check("Rights", "admin must not end a process of the run", () =>
    failsWith(users.admin.call(processesContracts.stop, { runId, processId: `1-${"0".repeat(64)}` }), "run-owner-only"));
};

const clientListed = async (env: CheckEnvironment): Promise<boolean> =>
  (await env.users.alice.call(workspaceContracts.clients.list, {})).some((entry) => entry.id === env.container.clientId);

const checkDisconnect = async (env: CheckEnvironment): Promise<void> => {
  const { report, container } = env;
  const titles = ["the files tab reports workspace-client-disconnected", "a tool call fails because of the disconnect",
    "after the restart the workspace registers again", "afterwards tools run in the container again"];
  const gone = await report.check("Disconnect", "docker stop removes the workspace from the registry", async () => {
    await stopContainer(container.name);
    await waitFor(async () => await clientListed(env) ? undefined : true, 30_000, "The disappearance of the workspace");
    return passed("unregistered");
  });
  if (!gone) {
    report.skip("Disconnect", titles, "the workspace is not disconnected");
    return;
  }
  await report.check("Disconnect", titles[0]!, () =>
    failsWith(env.users.alice.call(workspaceContracts.browse.list, { runId: env.runId, root: "workspace", path: "" }), "workspace-client-disconnected"));
  await report.check("Disconnect", titles[1]!, async () => {
    const turn = await runScript(env, "Check the disconnected workspace.", { id: "disconnected", steps: [{ tool: "bash", input: { command: "uname -s" } }] });
    const outcome = stepOf(turn, 0, "bash");
    expect(outcome.error !== undefined, `bash succeeds despite the disconnect: ${textOf(outcome.output)}`);
    expect(/not connected|lost the connection/.test(outcome.error), `Unexpected cause: ${outcome.error}`);
    return passed(outcome.error);
  });
  const back = await report.check("Disconnect", titles[2]!, async () => {
    await restartContainer(container.name);
    await waitFor(async () => await clientListed(env) ? true : undefined, 180_000, "The renewed registration").catch(async (error: unknown) => {
      throw new Error(`${messageOf(error)}; end of the container log:\n${tail(await containerLogs(container.name))}`);
    });
    return passed("docker start, registered again");
  });
  if (!back) {
    report.skip("Disconnect", [titles[3]!], "the workspace does not register again");
    return;
  }
  await report.check("Disconnect", titles[3]!, async () => {
    const turn = await runScript(env, "Check the reconnected workspace.", { id: "back-again", steps: [{ tool: "bash", input: { command: "cat README.md; uname -s" } }] });
    const text = completedText(stepOf(turn, 0, "bash"));
    expect(text.includes(env.nonce) && text.includes("Linux"), `Unexpected output: ${text.slice(0, 200)}`);
    return passed("bash reads README.md in the container");
  });
};

/** The stream breaks, the workspace lives on: a stop during this time waits for it and takes effect as soon as it is back. */
const checkStreamLoss = async (env: CheckEnvironment): Promise<void> => {
  const { report, container } = env;
  const titles = ["the stop during the disconnect succeeds, the process in the container is still running", "with the network the workspace comes back and the stop takes effect"];
  const started = await report.check("Stream loss", "a marked process runs, then the container loses the network", async () => {
    const entry = await markedContainerProcess(env, "3143");
    await disconnectNetwork(container.name);
    return { value: entry, detail: `sleep 3143 (PID ${entry.pid}) in the container, network disconnected` };
  });
  if (!started) {
    report.skip("Stream loss", titles, "the process or the disconnect is missing");
    return;
  }
  await report.check("Stream loss", titles[0]!, async () => {
    const begun = Date.now();
    await env.users.alice.call(coreContracts.chat.stop, { runId: env.runId });
    expect(await containerProcessAlive(container.name, started.pid), `PID ${started.pid} has already ended although the container has no network`);
    return passed(`ragents.chat.stop after ${Math.round((Date.now() - begun) / 1000)} s, PID ${started.pid} keeps running`);
  });
  await report.check("Stream loss", titles[1]!, async () => {
    await connectNetwork(container.name);
    await waitFor(async () => await containerProcessAlive(container.name, started.pid) ? undefined : true, 150_000, `The end of sleep 3143 after the network returns`);
    await waitFor(async () => await clientListed(env) ? true : undefined, 60_000, "The registration after the network returns");
    return passed(`PID ${started.pid} ended, workspace registered`);
  });
};

/** The emergency stop stops the run; both executors clean up, the one in the container and the server's one that carries the run's TypeScript platform. */
const checkRunStop = (env: CheckEnvironment): Promise<true | undefined> =>
  env.report.check("Stop", "admin stops the run; that cleans up in the container and on the server", async () => {
    const entry = await markedContainerProcess(env, "3142");
    expect(alive(env.decoyPid), `The marked process ${env.decoyPid} on the server had already ended before the stop`);
    await env.users.admin.call(coreContracts.chat.stop, { runId: env.runId });
    await waitFor(async () => await containerProcessAlive(env.container.name, entry.pid) ? undefined : true, 30_000, "The end of sleep 3142 in the container");
    await waitFor(async () => alive(env.decoyPid) ? undefined : true, 15_000, `The end of the marked process ${env.decoyPid} on the server`);
    return passed(`ragents.chat.stop; sleep 3142 (PID ${entry.pid}) in the container and PID ${env.decoyPid} on the server ended`);
  });

const checkStopAll = (env: CheckEnvironment): Promise<true | undefined> =>
  env.report.check("Stop", "admin may stop the whole run with ragents.runs.stopAll", async () => {
    await env.users.admin.call(runContracts.stopAll, { runId: env.runId, commandId: randomUUID(), reason: "Check run ended" });
    return passed("succeeds");
  });

/** The domain checks in fixed order; if a prerequisite is missing, the dependent checks are skipped. */
export const runChecks = async (env: CheckEnvironment): Promise<void> => {
  const areas = ["Run", "Tools", "Roots", "New folder", "Files", "Processes", "Services", "Rights", "Stop", "Disconnect", "Stream loss"];
  if (!await checkRegistry(env)) {
    for (const area of areas) env.report.skip(area, ["all checks"], "the workspace is not registered");
    return;
  }
  if (!await checkBinding(env)) {
    for (const area of areas.slice(1)) env.report.skip(area, ["all checks"], "there is no bound run");
    return;
  }
  await checkTools(env);
  await checkAttachment(env);
  await checkServerRoots(env);
  await checkFreshFolder(env);
  if (env.browserPort !== undefined) await checkBrowser(env, env.browserPort);
  await checkFiles(env);
  await checkProcesses(env);
  await checkServices(env);
  await checkRights(env);
  await checkRunStop(env);
  await checkDisconnect(env);
  await checkStreamLoss(env);
  await checkStopAll(env);
};
