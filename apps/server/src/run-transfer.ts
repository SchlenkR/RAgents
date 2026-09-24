import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { create as createTar, extract as extractTar } from "tar";
import { DomainError, isPendingActorInput, isRunId, type CommandRecord, type RunState } from "@ragents/engine";
import { parseJournalRecord } from "@ragents/engine/src/runtime/journal-storage";

export const RUN_TRANSFER_FORMAT_VERSION = 1;

export const RUN_TRANSFER_DIRECTORY = "transfer";

export const RUN_TRANSFER_MANIFEST_ENTRY = `${RUN_TRANSFER_DIRECTORY}/manifest.json`;

export const RUN_TRANSFER_MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;

/** Was ein Archiv über den Run sagt, den es trägt; das Ziel prüft daran, ob es ihn annehmen kann. */
export interface RunTransferManifest {
  readonly formatVersion: number;
  readonly runId: string;
  readonly hostVersion: string;
  readonly executorVersion: string;
  readonly profile: string;
  readonly title: string;
  readonly revision: number;
  readonly events: number;
  /** Der Projektordner auf dem Rechner der Quelle, an den der Run gebunden ist; null, wenn der Arbeitsbereich mitzieht. */
  readonly boundDirectory: string | null;
  readonly exportedAt: string;
}

export interface RunTransferExport {
  readonly manifest: RunTransferManifest;
  /** Das tar.gz als Base64, weil die Nachrichtenschicht JSON überträgt. */
  readonly archive: string;
}

export interface RunTransferImport {
  readonly manifest: RunTransferManifest;
  /** Die letzte Sequenz des wiedergegebenen Journals auf dem Ziel. */
  readonly sequence: number;
  readonly events: number;
  readonly workspace: string;
  readonly boundDirectory: string | null;
}

export interface RunTransferPlaces {
  readonly dataDirectory: string;
  readonly hostVersion: string;
  readonly executorVersion: string;
}

export const runTransferRunDirectory = (dataDirectory: string, runId: string): string =>
  path.join(dataDirectory, "runs", runId);

export const runTransferSessionDirectory = (dataDirectory: string, runId: string): string =>
  path.join(dataDirectory, "sessions", runId);

export const runTransferStagingDirectory = (dataDirectory: string, name: string): string =>
  path.join(dataDirectory, RUN_TRANSFER_DIRECTORY, name);

const assertRunId = (runId: string): string => {
  if (!isRunId(runId)) throw new DomainError("invalid-run", `Ungültige Run-Kennung: ${runId}`, 400);
  return runId;
};

/** Der Export braucht einen ruhenden Run: sonst wäre das Archiv ein Schnappschuss mitten in einem Turn. */
export const assertRunStopped = (options: {
  runId: string;
  state: RunState;
  isRunning: (actorId: string) => boolean;
  sessionRunning: boolean;
}): void => {
  const { runId, state } = options;
  const working = [...state.actors.values()].find((actor) => actor.kind !== "human"
    && (actor.lifecycle.kind === "running" || options.isRunning(actor.id)));
  if (working) throw new DomainError("run-transfer-running", `Der Run ${runId} arbeitet gerade (@${working.handle}); stoppe ihn vor dem Umzug.`, 409);
  const pending = [...state.inputs.values()].find(isPendingActorInput);
  if (pending) {
    const target = state.actors.get(pending.actorId)?.handle ?? pending.actorId;
    throw new DomainError("run-transfer-running", `Der Run ${runId} hat eine wartende Eingabe für @${target}; warte sie ab oder stoppe den Run.`, 409);
  }
  if (options.sessionRunning) throw new DomainError("run-transfer-running", `Der Run ${runId} arbeitet gerade; stoppe ihn vor dem Umzug.`, 409);
};

/** Ein Run mit Bindung an einen Projektordner der Quelle braucht auf dem Ziel einen Ersatzordner. */
export const assertWorkspaceReplacement = (manifest: RunTransferManifest, workspacePath: string | undefined): void => {
  if (manifest.boundDirectory === null || workspacePath !== undefined) return;
  throw new DomainError(
    "run-transfer-binding",
    `Der Run ${manifest.runId} ist an den Projektordner ${manifest.boundDirectory} des Quellservers gebunden; nenne beim Import einen Ersatzordner auf diesem Server.`,
    409,
  );
};

/** Der Run behält seine Kennung, also muss sie im Ziel frei sein: kein Journal, kein Ordner, kein Archiv. */
export const assertRunIdFree = (options: { runId: string; known: boolean; directories: readonly string[] }): void => {
  if (options.known) throw new DomainError("run-transfer-exists", `Den Run ${options.runId} gibt es auf diesem Server schon.`, 409);
  for (const directory of options.directories) {
    if (existsSync(directory)) throw new DomainError("run-transfer-exists", `Die Kennung ${options.runId} ist auf diesem Server belegt: ${directory}`, 409);
  }
};

// Halbfertige Journal- und Payload-Schreibvorgänge gehören nie ins Archiv.
const temporary = (entry: string): boolean => {
  const name = path.basename(entry);
  return name.startsWith(".journal.") || name.startsWith(".payload.");
};

export const packRunArchive = async (options: {
  places: RunTransferPlaces;
  runId: string;
  manifest: RunTransferManifest;
}): Promise<Buffer> => {
  const runId = assertRunId(options.runId);
  const { dataDirectory } = options.places;
  if (!existsSync(path.join(runTransferRunDirectory(dataDirectory, runId), "journal.jsonl"))) {
    throw new DomainError("run-transfer-missing", `Der Run ${runId} hat kein Journal unter ${runTransferRunDirectory(dataDirectory, runId)}`, 404);
  }
  const manifestFile = path.join(dataDirectory, ...RUN_TRANSFER_MANIFEST_ENTRY.split("/"));
  await mkdir(path.dirname(manifestFile), { recursive: true, mode: 0o700 });
  await writeFile(manifestFile, `${JSON.stringify(options.manifest, null, 2)}\n`, "utf8");
  const entries = [
    RUN_TRANSFER_MANIFEST_ENTRY,
    `runs/${runId}`,
    ...(existsSync(runTransferSessionDirectory(dataDirectory, runId)) ? [`sessions/${runId}`] : []),
  ];
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of createTar({ gzip: true, cwd: dataDirectory, portable: true, filter: (entry) => !temporary(entry) }, entries)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } finally {
    await rm(manifestFile, { force: true });
  }
  const archive = Buffer.concat(chunks);
  if (archive.byteLength > RUN_TRANSFER_MAX_ARCHIVE_BYTES) {
    throw new DomainError(
      "run-transfer-too-large",
      `Das Archiv des Runs ${runId} hat ${archive.byteLength} Byte und überschreitet die Grenze von ${RUN_TRANSFER_MAX_ARCHIVE_BYTES} Byte der Nachrichtenschicht`,
      413,
    );
  }
  return archive;
};

const manifestOf = (value: unknown, location: string): RunTransferManifest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${location} ist kein Objekt`);
  const raw = value as Record<string, unknown>;
  const text = (key: string): string => {
    const entry = raw[key];
    if (typeof entry !== "string" || !entry) throw new Error(`${location}.${key} fehlt`);
    return entry;
  };
  const count = (key: string): number => {
    const entry = raw[key];
    if (typeof entry !== "number" || !Number.isSafeInteger(entry) || entry < 0) throw new Error(`${location}.${key} ist keine Anzahl`);
    return entry;
  };
  if (raw.formatVersion !== RUN_TRANSFER_FORMAT_VERSION) {
    throw new Error(`${location}.formatVersion ${String(raw.formatVersion)} wird nicht unterstützt; erwartet ${RUN_TRANSFER_FORMAT_VERSION}`);
  }
  if (raw.boundDirectory !== null && typeof raw.boundDirectory !== "string") throw new Error(`${location}.boundDirectory ist weder Pfad noch null`);
  return {
    formatVersion: RUN_TRANSFER_FORMAT_VERSION,
    runId: assertRunId(text("runId")),
    hostVersion: text("hostVersion"),
    executorVersion: text("executorVersion"),
    profile: text("profile"),
    title: typeof raw.title === "string" ? raw.title : "",
    revision: count("revision"),
    events: count("events"),
    boundDirectory: raw.boundDirectory,
    exportedAt: text("exportedAt"),
  };
};

export interface UnpackedRun {
  readonly manifest: RunTransferManifest;
  readonly staging: string;
  readonly records: readonly CommandRecord[];
}

const onlyEntry = async (directory: string, expected: string, location: string): Promise<void> => {
  const unexpected = (await readdir(directory)).filter((entry) => entry !== expected);
  if (unexpected.length > 0) throw new DomainError("run-transfer-invalid", `${location} enthält neben ${expected} noch ${unexpected.join(", ")}`, 400);
};

/** Entpackt das Archiv in einen Staging-Ordner des Ziels und liest Manifest und Journalrecords daraus. */
export const unpackRunArchive = async (options: {
  places: RunTransferPlaces;
  archive: Buffer;
  staging: string;
}): Promise<UnpackedRun> => {
  const { staging } = options;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true, mode: 0o700 });
  const file = path.join(staging, "archive.tar.gz");
  await writeFile(file, options.archive);
  await extractTar({ file, cwd: staging, strict: true });
  await rm(file);
  const manifestFile = path.join(staging, ...RUN_TRANSFER_MANIFEST_ENTRY.split("/"));
  if (!existsSync(manifestFile)) throw new DomainError("run-transfer-invalid", `Das Archiv enthält kein ${RUN_TRANSFER_MANIFEST_ENTRY}`, 400);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch (error) {
    throw new DomainError("run-transfer-invalid", `Das Manifest des Archivs ist kein gültiges JSON: ${error instanceof Error ? error.message : String(error)}`, 400);
  }
  let manifest: RunTransferManifest;
  try {
    manifest = manifestOf(parsed, "Das Manifest");
  } catch (error) {
    throw new DomainError("run-transfer-invalid", error instanceof Error ? error.message : String(error), 400);
  }
  const { hostVersion, executorVersion } = options.places;
  if (manifest.hostVersion !== hostVersion) {
    throw new DomainError(
      "run-transfer-host-version",
      `Das Archiv kommt vom Host ${manifest.hostVersion}, dieser Server läuft auf ${hostVersion}; ein Umzug geht nur zwischen gleichen Host-Versionen`,
      409,
    );
  }
  if (manifest.executorVersion !== executorVersion) {
    throw new DomainError(
      "run-transfer-executor-version",
      `Das Archiv bringt den Executor ${manifest.executorVersion} mit, dieser Server hat ${executorVersion}`,
      409,
    );
  }
  const runDirectory = path.join(staging, "runs", manifest.runId);
  const journalFile = path.join(runDirectory, "journal.jsonl");
  if (!existsSync(journalFile)) throw new DomainError("run-transfer-invalid", `Das Archiv enthält kein Journal für den Run ${manifest.runId}`, 400);
  await onlyEntry(path.join(staging, "runs"), manifest.runId, "Der Ordner runs des Archivs");
  if (existsSync(path.join(staging, "sessions"))) {
    await onlyEntry(path.join(staging, "sessions"), manifest.runId, "Der Ordner sessions des Archivs");
  }
  const lines = (await readFile(journalFile, "utf8")).split("\n").filter((line) => line.trim().length > 0);
  const records = lines.map((line, index) => parseJournalRecord(line, runDirectory, `${journalFile}:${index + 1}`));
  if (records.length === 0) throw new DomainError("run-transfer-invalid", `Das Journal des Runs ${manifest.runId} im Archiv ist leer`, 400);
  const foreign = records.find((record) => record.runId !== manifest.runId);
  if (foreign) throw new DomainError("run-transfer-invalid", `Das Journal im Archiv gehört zum Run ${foreign.runId}, nicht zu ${manifest.runId}`, 400);
  const events = records.reduce((total, record) => total + record.events.length, 0);
  if (events !== manifest.events) {
    throw new DomainError("run-transfer-invalid", `Das Manifest nennt ${manifest.events} Ereignisse, das Journal im Archiv hat ${events}`, 400);
  }
  return { manifest, staging, records };
};

/** Legt die Session-Ablage des Archivs an ihrem Platz im Ziel ab; das Journal übernimmt danach die Records. */
export const installSessionDirectory = async (options: {
  places: RunTransferPlaces;
  runId: string;
  staging: string;
  mode: number;
}): Promise<string | null> => {
  const source = path.join(options.staging, "sessions", options.runId);
  if (!existsSync(source)) return null;
  const target = runTransferSessionDirectory(options.places.dataDirectory, options.runId);
  if (existsSync(target)) throw new DomainError("run-transfer-exists", `Die Session-Ablage ${target} gibt es schon`, 409);
  await mkdir(path.dirname(target), { recursive: true });
  await rename(source, target);
  await chmod(target, options.mode);
  return target;
};
