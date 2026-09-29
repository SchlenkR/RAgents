import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { profileFilePath, resolveProfileUsers } from "../../apps/server/src/config-file.ts";
import { readProfileTarget } from "../../apps/server/src/profile-target.ts";
import { coreContracts } from "../../apps/server/src/api/contracts.ts";
import { RpcClient } from "../../apps/web/src/rpc/client.ts";
import { journalLines, readJournal, usageByActor } from "../agent/journal.ts";
import { interruptPrimaryTurn, stopWholeRun } from "../agent/turn-control.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

interface DriverConfig {
  baseUrl: string;
  dataDirectory: string;
  user?: { id: string; password: string };
}

const usage = (): string => `Usage: PRODUCT_PROFILE=<profile> [PRODUCT_PROFILE_FILE=<path>] [RAGENTS_DRIVER_USER=<id>] pnpm driver <command>
  new-run [entry]                 creates a run from a template (default ragents.reference.shared-actor-list)
  send <runId> <@actor> <text>    sends a message to an actor of the run
  stop <runId>                    interrupts the running turn of the primary actor; the run stays active
  stop <runId> --run              emergency stop: cancels all turns and stops all actors of the run
  sessions                        lists the runs of the profile
  journal <runId> [--since N] [--chat|--tools|--all]   reads the journal
  usage <runId>                   token balance per actor
The commands go as JSON-RPC to POST <address>/rpc. The profile file is in the root or
where PRODUCT_PROFILE_FILE points. The address comes from host.PORT of the profile file
(RAGENTS_DRIVER_URL overrides it), the data folder from DATA_DIR or the profile's
default. If the profile defines users, RAGENTS_DRIVER_USER is required; the driver reads the
password from the profile file. It sends a set ACCESS_TOKEN as a
bearer token.`;

/** Port, data folder and password as on the server: environment before profile file, env("...") resolved. */
export const loadConfig = async (environment: NodeJS.ProcessEnv = process.env): Promise<DriverConfig> => {
  const profile = environment.PRODUCT_PROFILE;
  const file = profileFilePath(root, environment);
  if (!profile || !file) throw new Error("PRODUCT_PROFILE is missing.");
  if (!existsSync(file)) throw new Error(`Profile file missing: ${file}`);
  const target = await readProfileTarget(profile, file, environment);
  const module = await import(pathToFileURL(file).href) as { users?: unknown };
  const users = resolveProfileUsers(file, module.users, environment) ?? [];
  const selected = (): DriverConfig["user"] => {
    if (users.length === 0) return undefined;
    const id = environment.RAGENTS_DRIVER_USER;
    if (!id) throw new Error(`The profile ${profile} requires sign-in: set RAGENTS_DRIVER_USER to one of the users ${users.map((entry) => entry.id).join(", ")}.`);
    const entry = users.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`User ${id} is not defined in the profile file.`);
    return { id: entry.id, password: entry.password };
  };
  return { baseUrl: environment.RAGENTS_DRIVER_URL ?? target.baseUrl, dataDirectory: target.dataDirectory, user: selected() };
};

const client = async (config: DriverConfig): Promise<RpcClient> => {
  let cookie = "";
  if (config.user) {
    const response = await fetch(`${config.baseUrl}/api/access/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: config.user.id, password: config.user.password }),
    });
    if (!response.ok) throw new Error(`Sign-in as ${config.user.id} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
    const header = response.headers.get("set-cookie");
    if (!header) throw new Error("The sign-in returned no session cookie.");
    cookie = header.split(";")[0]!;
  }
  const token = process.env.ACCESS_TOKEN;
  return new RpcClient({
    baseUrl: config.baseUrl,
    fetch: (input, init) => fetch(input, {
      ...init,
      headers: {
        ...init?.headers as Record<string, string> | undefined,
        ...(cookie ? { cookie } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }),
  });
};

export const stopCommand = async (rpc: RpcClient, args: readonly string[]): Promise<string> => {
  const [runId, ...flags] = args;
  if (!runId || runId.startsWith("--")) throw new Error("Run id missing.");
  const unknown = flags.find((flag) => flag !== "--run");
  if (unknown) throw new Error(`Unknown argument ${unknown}.`);
  if (flags.includes("--run")) {
    await stopWholeRun(rpc, runId);
    return "Run stopped (emergency stop)";
  }
  return `Turn of ${await interruptPrimaryTurn(rpc, runId)} interrupted`;
};

const main = async (): Promise<void> => {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help") {
    console.log(usage());
    return;
  }
  const config = await loadConfig();
  if (command === "journal" || command === "usage") {
    const runId = args[0];
    if (!runId) throw new Error("Run id missing.");
    const events = readJournal(config.dataDirectory, runId);
    if (command === "usage") {
      console.log("Actor | calls | input | cacheRead | output | costUsd");
      for (const [actor, entry] of usageByActor(events)) {
        console.log(`${actor.slice(0, 14)} ${entry.calls} ${entry.inputTokens} ${entry.cacheReadTokens} ${entry.outputTokens} ${entry.costUsd.toFixed(4)}`);
      }
      return;
    }
    const sinceIndex = args.indexOf("--since");
    const since = sinceIndex >= 0 ? Number(args[sinceIndex + 1]) : 0;
    const mode = args.includes("--all") ? "all" : args.includes("--tools") ? "tools" : "chat";
    for (const line of journalLines(events, mode, since)) console.log(line);
    return;
  }
  const rpc = await client(config);
  if (command === "new-run") {
    const id = randomUUID();
    await rpc.call(coreContracts.chat.start, { runId: id, entry: args[0] ?? "ragents.reference.shared-actor-list" });
    console.log(id);
  } else if (command === "send") {
    const [runId, actor, ...rest] = args;
    if (!runId || !actor || rest.length === 0) throw new Error("send needs <runId> <@actor> <text>.");
    await rpc.call(coreContracts.chat.sendToActor, { runId, actorId: actor, text: rest.join(" ") });
    console.log("sent");
  } else if (command === "stop") {
    console.log(await stopCommand(rpc, args));
  } else if (command === "sessions") {
    console.log(JSON.stringify(await rpc.call(coreContracts.runs.list, {})));
  } else {
    throw new Error(`Unknown command ${command}.\n${usage()}`);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
