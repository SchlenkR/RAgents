import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDataDirectory } from "../../apps/server/src/data-directory.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

interface DriverConfig {
  baseUrl: string;
  dataDirectory: string;
  user?: { id: string; password: string };
}

interface JournalEvent {
  sequence: number;
  type: string;
  payload?: Record<string, unknown>;
}

interface JournalRecord {
  command?: { actorId?: string };
  events: JournalEvent[];
}

export interface ActorUsage {
  calls: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
}

const usage = (): string => `Verwendung: PRODUCT_PROFILE=<profil> [RAGENTS_DRIVER_USER=<id>] pnpm driver <befehl>
  new-run [entry]                 legt einen Run über einen Start-Einstieg an (Standard ragents.reference.shared-actor-list)
  send <runId> <@actor> <text>    schickt eine Nachricht an einen Actor des Runs
  stop <runId>                    stoppt die laufenden Turns des Runs
  sessions                        listet die Runs des Profils
  journal <runId> [--since N] [--chat|--tools|--all]   liest das Journal
  usage <runId>                   Tokenbilanz je Actor
Die Adresse kommt aus host.PORT der Profildatei (RAGENTS_DRIVER_URL überschreibt sie), der
Datenordner aus DATA_DIR bzw. dem Standard des Profils. Definiert das Profil Benutzer, ist
RAGENTS_DRIVER_USER Pflicht; das Passwort liest der Treiber aus der Profildatei.`;

const loadConfig = async (): Promise<DriverConfig> => {
  const profile = process.env.PRODUCT_PROFILE;
  if (!profile) throw new Error("PRODUCT_PROFILE fehlt.");
  const file = path.join(root, `ragents.config.${profile}.ts`);
  if (!existsSync(file)) throw new Error(`Profildatei fehlt: ${file}`);
  const module = await import(file) as { config: { host: { PORT?: number; DATA_DIR?: unknown } }; users?: { id: string; password: string }[] };
  const port = Number(process.env.PORT || module.config.host.PORT);
  if (!Number.isInteger(port) || port <= 0) throw new Error("host.PORT der Profildatei ist keine gültige Portnummer.");
  const configured = module.config.host.DATA_DIR;
  const dataDirectory = path.resolve(process.env.DATA_DIR ?? (typeof configured === "string" ? configured : defaultDataDirectory(profile)));
  const users = module.users ?? [];
  let user: DriverConfig["user"];
  if (users.length > 0) {
    const id = process.env.RAGENTS_DRIVER_USER;
    if (!id) throw new Error(`Das Profil ${profile} verlangt eine Anmeldung: RAGENTS_DRIVER_USER auf einen der Benutzer ${users.map((entry) => entry.id).join(", ")} setzen.`);
    const entry = users.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Benutzer ${id} ist in der Profildatei nicht definiert.`);
    user = { id: entry.id, password: entry.password };
  }
  return { baseUrl: process.env.RAGENTS_DRIVER_URL ?? `http://localhost:${port}`, dataDirectory, user };
};

const client = async (config: DriverConfig) => {
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
  return async (method: string, route: string, body?: unknown): Promise<string> => {
    const response = await fetch(config.baseUrl + route, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${route} -> ${response.status}: ${text.slice(0, 400)}`);
    return text;
  };
};

const readJournal = (dataDirectory: string, runId: string): JournalRecord[] => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(runId)) throw new Error("Ungültige Run-Id.");
  const file = path.join(dataDirectory, "runs", runId, "journal.jsonl");
  if (!existsSync(file)) throw new Error(`Journal fehlt: ${file}`);
  return readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as JournalRecord);
};

export const usageByActor = (records: JournalRecord[]): Map<string, ActorUsage> => {
  const result = new Map<string, ActorUsage>();
  for (const record of records) {
    const actor = record.command?.actorId ?? "";
    for (const event of record.events) {
      const model = event.payload?.usage as Record<string, unknown> | undefined;
      if (!model) continue;
      const entry = result.get(actor) ?? { calls: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0 };
      entry.calls += 1;
      for (const key of ["inputTokens", "cacheReadTokens", "outputTokens", "costUsd"] as const) {
        const value = model[key];
        if (typeof value === "number") entry[key] += value;
      }
      result.set(actor, entry);
    }
  }
  return result;
};

const text = (value: unknown): string => (typeof value === "string" ? value : "").replace(/\n/g, " ");

export const journalLines = (records: JournalRecord[], mode: "chat" | "tools" | "all", since: number): string[] => {
  const lines: string[] = [];
  for (const record of records) {
    const actor = (record.command?.actorId ?? "").slice(0, 14);
    for (const event of record.events) {
      if (event.sequence < since) continue;
      const payload = event.payload ?? {};
      const type = event.type;
      if (type === "model.output.completed" && mode !== "tools") {
        const output = text(payload.text);
        if (output.trim()) lines.push(`[${event.sequence}] ${actor}: ${output.slice(0, 800)}`);
      } else if (type === "actor.input.enqueued" && mode !== "tools") {
        const input = payload.input as Record<string, unknown> | undefined;
        lines.push(`[${event.sequence}] INPUT -> ${String(payload.actorId ?? "").slice(0, 14)}: ${text(payload.text ?? input?.text).slice(0, 300)}`);
      } else if (type.startsWith("tool.call.") && mode !== "chat") {
        const body = type.endsWith("started") ? payload.input : type.endsWith("failed") ? payload.error : undefined;
        if (body !== undefined) lines.push(`[${event.sequence}] ${type.split(".").pop()} ${actor} ${String(payload.name ?? "")}: ${JSON.stringify(body).slice(0, 300)}`);
      } else if (mode !== "tools" && (type.includes("failed") || type.includes("stopped") || type.includes("question"))) {
        lines.push(`[${event.sequence}] ${type} ${actor}: ${JSON.stringify(payload).slice(0, 300)}`);
      }
    }
  }
  const last = records.at(-1)?.events.at(-1)?.sequence ?? 0;
  lines.push(`-- letzte Sequenz: ${last}`);
  return lines;
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
    const records = readJournal(config.dataDirectory, runId);
    if (command === "usage") {
      console.log("Actor | Aufrufe | input | cacheRead | output | costUsd");
      for (const [actor, entry] of usageByActor(records)) {
        console.log(`${actor.slice(0, 14)} ${entry.calls} ${entry.inputTokens} ${entry.cacheReadTokens} ${entry.outputTokens} ${entry.costUsd.toFixed(4)}`);
      }
      return;
    }
    const sinceIndex = args.indexOf("--since");
    const since = sinceIndex >= 0 ? Number(args[sinceIndex + 1]) : 0;
    const mode = args.includes("--all") ? "all" : args.includes("--tools") ? "tools" : "chat";
    for (const line of journalLines(records, mode, since)) console.log(line);
    return;
  }
  const call = await client(config);
  if (command === "new-run") {
    const id = randomUUID();
    await call("POST", `/chat/${id}/start`, { entry: args[0] ?? "ragents.reference.shared-actor-list" });
    console.log(id);
  } else if (command === "send") {
    const [runId, actor, ...rest] = args;
    if (!runId || !actor || rest.length === 0) throw new Error("send braucht <runId> <@actor> <text>.");
    await call("POST", `/chat/${runId}/actors/${encodeURIComponent(actor)}/send`, { text: rest.join(" ") });
    console.log("gesendet");
  } else if (command === "stop") {
    if (!args[0]) throw new Error("Run-Id fehlt.");
    await call("POST", `/chat/${args[0]}/stop`);
    console.log("gestoppt");
  } else if (command === "sessions") {
    console.log(await call("GET", "/chat/sessions"));
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
