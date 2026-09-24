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

const usage = (): string => `Verwendung: PRODUCT_PROFILE=<profil> [PRODUCT_PROFILE_FILE=<pfad>] [RAGENTS_DRIVER_USER=<id>] pnpm driver <befehl>
  new-run [entry]                 legt einen Run über eine Vorlage an (Standard ragents.reference.shared-actor-list)
  send <runId> <@actor> <text>    schickt eine Nachricht an einen Actor des Runs
  stop <runId>                    unterbricht den laufenden Turn des Primary-Actors; der Run bleibt aktiv
  stop <runId> --run              Not-Aus: bricht alle Turns ab und stoppt alle Actors des Runs
  sessions                        listet die Runs des Profils
  journal <runId> [--since N] [--chat|--tools|--all]   liest das Journal
  usage <runId>                   Tokenbilanz je Actor
Die Befehle gehen als JSON-RPC an POST <adresse>/rpc. Die Profildatei liegt in der Wurzel oder
dort, wohin PRODUCT_PROFILE_FILE zeigt. Die Adresse kommt aus host.PORT der Profildatei
(RAGENTS_DRIVER_URL überschreibt sie), der Datenordner aus DATA_DIR bzw. dem Standard des
Profils. Definiert das Profil Benutzer, ist RAGENTS_DRIVER_USER Pflicht; das
Passwort liest der Treiber aus der Profildatei. Ein gesetztes ACCESS_TOKEN sendet er als
Bearer-Token.`;

/** Port, Datenordner und Passwort wie beim Server: Umgebung vor Profildatei, env("...") aufgelöst. */
export const loadConfig = async (environment: NodeJS.ProcessEnv = process.env): Promise<DriverConfig> => {
  const profile = environment.PRODUCT_PROFILE;
  const file = profileFilePath(root, environment);
  if (!profile || !file) throw new Error("PRODUCT_PROFILE fehlt.");
  if (!existsSync(file)) throw new Error(`Profildatei fehlt: ${file}`);
  const target = await readProfileTarget(profile, file, environment);
  const module = await import(pathToFileURL(file).href) as { users?: unknown };
  const users = resolveProfileUsers(file, module.users, environment) ?? [];
  const selected = (): DriverConfig["user"] => {
    if (users.length === 0) return undefined;
    const id = environment.RAGENTS_DRIVER_USER;
    if (!id) throw new Error(`Das Profil ${profile} verlangt eine Anmeldung: RAGENTS_DRIVER_USER auf einen der Benutzer ${users.map((entry) => entry.id).join(", ")} setzen.`);
    const entry = users.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Benutzer ${id} ist in der Profildatei nicht definiert.`);
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
    if (!response.ok) throw new Error(`Anmeldung als ${config.user.id} fehlgeschlagen: ${response.status} ${(await response.text()).slice(0, 200)}`);
    const header = response.headers.get("set-cookie");
    if (!header) throw new Error("Die Anmeldung lieferte kein Sitzungscookie.");
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
  if (!runId || runId.startsWith("--")) throw new Error("Run-Id fehlt.");
  const unknown = flags.find((flag) => flag !== "--run");
  if (unknown) throw new Error(`Unbekanntes Argument ${unknown}.`);
  if (flags.includes("--run")) {
    await stopWholeRun(rpc, runId);
    return "Run angehalten (Not-Aus)";
  }
  return `Turn von ${await interruptPrimaryTurn(rpc, runId)} unterbrochen`;
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
    if (!runId) throw new Error("Run-Id fehlt.");
    const events = readJournal(config.dataDirectory, runId);
    if (command === "usage") {
      console.log("Actor | Aufrufe | input | cacheRead | output | costUsd");
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
    if (!runId || !actor || rest.length === 0) throw new Error("send braucht <runId> <@actor> <text>.");
    await rpc.call(coreContracts.chat.sendToActor, { runId, actorId: actor, text: rest.join(" ") });
    console.log("gesendet");
  } else if (command === "stop") {
    console.log(await stopCommand(rpc, args));
  } else if (command === "sessions") {
    console.log(JSON.stringify(await rpc.call(coreContracts.runs.list, {})));
  } else {
    throw new Error(`Unbekannter Befehl ${command}.\n${usage()}`);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
