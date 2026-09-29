import { createHash } from "node:crypto";
import { existsSync, readlinkSync, Stats } from "node:fs";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { create as createTar, extract as extractTar, type ReadEntry } from "tar";
import { DomainError, isPendingActorInput, isRunId, type CommandRecord, type JournalEvent, type RunState } from "@ragents/engine";
import { parseJournalRecord } from "@ragents/engine/src/runtime/journal-storage";

export const RUN_TRANSFER_FORMAT_VERSION = 1;

export const RUN_TRANSFER_DIRECTORY = "transfer";

export const RUN_TRANSFER_MANIFEST_ENTRY = `${RUN_TRANSFER_DIRECTORY}/manifest.json`;

export const RUN_TRANSFER_MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;

/** What an archive says about the run it carries; the target uses it to check whether it can accept the run. */
export interface RunTransferManifest {
  readonly formatVersion: number;
  readonly runId: string;
  readonly hostVersion: string;
  readonly executorVersion: string;
  readonly profile: string;
  readonly title: string;
  readonly revision: number;
  readonly events: number;
  /** The project folder on the source machine to which the run is bound; null if the workspace moves along. */
  readonly boundDirectory: string | null;
  readonly exportedAt: string;
}

export interface RunTransferExport {
  readonly manifest: RunTransferManifest;
  /** The tar.gz as Base64, because the message layer transfers JSON. */
  readonly archive: string;
}

export interface RunTransferImport {
  readonly manifest: RunTransferManifest;
  /** The last sequence of the replayed journal on the target. */
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
  if (!isRunId(runId)) throw new DomainError("invalid-run", `Invalid run id: ${runId}`, 400);
  return runId;
};

/** The export needs an idle run: otherwise the archive would be a snapshot in the middle of a turn. */
export const assertRunStopped = (options: {
  runId: string;
  state: RunState;
  isRunning: (actorId: string) => boolean;
  sessionRunning: boolean;
}): void => {
  const { runId, state } = options;
  const working = [...state.actors.values()].find((actor) => actor.kind !== "human"
    && (actor.lifecycle.kind === "running" || options.isRunning(actor.id)));
  if (working) throw new DomainError("run-transfer-running", `The run ${runId} is working right now (@${working.handle}); stop it before the move.`, 409);
  const pending = [...state.inputs.values()].find(isPendingActorInput);
  if (pending) {
    const target = state.actors.get(pending.actorId)?.handle ?? pending.actorId;
    throw new DomainError("run-transfer-running", `The run ${runId} has a pending input for @${target}; wait for it or stop the run.`, 409);
  }
  if (options.sessionRunning) throw new DomainError("run-transfer-running", `The run ${runId} is working right now; stop it before the move.`, 409);
};

/** A run bound to a project folder of the source needs a replacement folder on the target. */
export const assertWorkspaceReplacement = (manifest: RunTransferManifest, workspacePath: string | undefined): void => {
  if (manifest.boundDirectory === null || workspacePath !== undefined) return;
  throw new DomainError(
    "run-transfer-binding",
    `The run ${manifest.runId} is bound to the project folder ${manifest.boundDirectory} of the source server; name a replacement folder on this server when importing.`,
    409,
  );
};

/** The run keeps its id, so it must be free on the target: no journal, no folder, no archive. */
export const assertRunIdFree = (options: { runId: string; known: boolean; directories: readonly string[] }): void => {
  if (options.known) throw new DomainError("run-transfer-exists", `The run ${options.runId} already exists on this server.`, 409);
  for (const directory of options.directories) {
    if (existsSync(directory)) throw new DomainError("run-transfer-exists", `The id ${options.runId} is taken on this server: ${directory}`, 409);
  }
};

/** The contents under artifacts/ that the run refers to: published artifacts and media of its model contexts. */
export const contentHashesOf = (events: readonly JournalEvent[]): string[] => [...new Set(events.flatMap((event) => {
  if (event.type === "artifact.published") return [event.payload.artifact.hash];
  const content = event.type === "model.input.presented" || event.type === "model.tool-result.presented" ? event.payload.content : undefined;
  return Array.isArray(content) ? content.flatMap((part) => "hash" in part ? [part.hash] : []) : [];
}))].sort();

const sha256 = /^[0-9a-f]{64}$/;

// Half-finished journal and payload writes never belong in the archive.
const temporary = (entry: string): boolean => {
  const name = path.basename(entry);
  return name.startsWith(".journal.") || name.startsWith(".payload.");
};

/** A link travels only inside the run's tree; one out of it below node_modules is left for the next install, elsewhere refused. */
const linkDecision = (dataDirectory: string, entry: string): "keep" | "skip" | "refuse" => {
  const file = path.join(dataDirectory, entry);
  const target = readlinkSync(file);
  const root = path.join(dataDirectory, ...entry.split("/").slice(0, 2));
  const resolved = path.resolve(path.dirname(file), target);
  if (!path.isAbsolute(target) && (resolved === root || resolved.startsWith(`${root}${path.sep}`))) return "keep";
  return entry.split("/").includes("node_modules") ? "skip" : "refuse";
};

export const packRunArchive = async (options: {
  places: RunTransferPlaces;
  runId: string;
  manifest: RunTransferManifest;
  contentHashes: readonly string[];
}): Promise<Buffer> => {
  const runId = assertRunId(options.runId);
  const { dataDirectory } = options.places;
  if (!existsSync(path.join(runTransferRunDirectory(dataDirectory, runId), "journal.jsonl"))) {
    throw new DomainError("run-transfer-missing", `The run ${runId} has no journal under ${runTransferRunDirectory(dataDirectory, runId)}`, 404);
  }
  const manifestFile = path.join(dataDirectory, ...RUN_TRANSFER_MANIFEST_ENTRY.split("/"));
  await mkdir(path.dirname(manifestFile), { recursive: true, mode: 0o700 });
  await writeFile(manifestFile, `${JSON.stringify(options.manifest, null, 2)}\n`, "utf8");
  const entries = [
    RUN_TRANSFER_MANIFEST_ENTRY,
    `runs/${runId}`,
    ...(existsSync(runTransferSessionDirectory(dataDirectory, runId)) ? [`sessions/${runId}`] : []),
    ...options.contentHashes.map((hash) => {
      if (!sha256.test(hash) || !existsSync(path.join(dataDirectory, "artifacts", hash))) {
        throw new DomainError("run-transfer-missing", `The content ${hash} of run ${runId} is missing under artifacts`, 404);
      }
      return `artifacts/${hash}`;
    }),
  ];
  const chunks: Buffer[] = [];
  const refused: string[] = [];
  const portable = (entry: string, stat: Stats | ReadEntry): boolean => {
    if (temporary(entry)) return false;
    if (!(stat instanceof Stats) || !stat.isSymbolicLink()) return true;
    const decision = linkDecision(dataDirectory, entry);
    if (decision === "refuse") refused.push(entry);
    return decision === "keep";
  };
  try {
    for await (const chunk of createTar({ gzip: true, cwd: dataDirectory, portable: true, filter: portable }, entries)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } finally {
    await rm(manifestFile, { force: true });
  }
  if (refused.length > 0) {
    throw new DomainError(
      "run-transfer-link",
      `Run ${runId} contains links that would point nowhere on the target: ${refused.join(", ")}. Replace them with files or relative links inside the run.`,
      409,
    );
  }
  const archive = Buffer.concat(chunks);
  if (archive.byteLength > RUN_TRANSFER_MAX_ARCHIVE_BYTES) {
    throw new DomainError(
      "run-transfer-too-large",
      `The archive of run ${runId} has ${archive.byteLength} bytes and exceeds the message layer's limit of ${RUN_TRANSFER_MAX_ARCHIVE_BYTES} bytes`,
      413,
    );
  }
  return archive;
};

const manifestOf = (value: unknown, location: string): RunTransferManifest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${location} is not an object`);
  const raw = value as Record<string, unknown>;
  const text = (key: string): string => {
    const entry = raw[key];
    if (typeof entry !== "string" || !entry) throw new Error(`${location}.${key} is missing`);
    return entry;
  };
  const count = (key: string): number => {
    const entry = raw[key];
    if (typeof entry !== "number" || !Number.isSafeInteger(entry) || entry < 0) throw new Error(`${location}.${key} is not a count`);
    return entry;
  };
  if (raw.formatVersion !== RUN_TRANSFER_FORMAT_VERSION) {
    throw new Error(`${location}.formatVersion ${String(raw.formatVersion)} is not supported; expected ${RUN_TRANSFER_FORMAT_VERSION}`);
  }
  if (raw.boundDirectory !== null && typeof raw.boundDirectory !== "string") throw new Error(`${location}.boundDirectory is neither a path nor null`);
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
  if (unexpected.length > 0) throw new DomainError("run-transfer-invalid", `${location} contains ${unexpected.join(", ")} besides ${expected}`, 400);
};

/** Unpacks the archive into a staging folder of the target and reads the manifest and journal records from it. */
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
  if (!existsSync(manifestFile)) throw new DomainError("run-transfer-invalid", `The archive contains no ${RUN_TRANSFER_MANIFEST_ENTRY}`, 400);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch (error) {
    throw new DomainError("run-transfer-invalid", `The archive's manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, 400);
  }
  let manifest: RunTransferManifest;
  try {
    manifest = manifestOf(parsed, "The manifest");
  } catch (error) {
    throw new DomainError("run-transfer-invalid", error instanceof Error ? error.message : String(error), 400);
  }
  const { hostVersion, executorVersion } = options.places;
  if (manifest.hostVersion !== hostVersion) {
    throw new DomainError(
      "run-transfer-host-version",
      `The archive comes from host ${manifest.hostVersion}, this server runs ${hostVersion}; a move only works between equal host versions`,
      409,
    );
  }
  if (manifest.executorVersion !== executorVersion) {
    throw new DomainError(
      "run-transfer-executor-version",
      `The archive brings executor ${manifest.executorVersion}, this server has ${executorVersion}`,
      409,
    );
  }
  const runDirectory = path.join(staging, "runs", manifest.runId);
  const journalFile = path.join(runDirectory, "journal.jsonl");
  if (!existsSync(journalFile)) throw new DomainError("run-transfer-invalid", `The archive contains no journal for run ${manifest.runId}`, 400);
  await onlyEntry(path.join(staging, "runs"), manifest.runId, "The archive's runs folder");
  if (existsSync(path.join(staging, "sessions"))) {
    await onlyEntry(path.join(staging, "sessions"), manifest.runId, "The archive's sessions folder");
  }
  if (existsSync(path.join(staging, "artifacts"))) {
    for (const name of await readdir(path.join(staging, "artifacts"))) {
      const content = sha256.test(name) ? await readFile(path.join(staging, "artifacts", name)) : undefined;
      if (!content || createHash("sha256").update(content).digest("hex") !== name) {
        throw new DomainError("run-transfer-invalid", `The archive content artifacts/${name} does not match its name`, 400);
      }
    }
  }
  const lines = (await readFile(journalFile, "utf8")).split("\n").filter((line) => line.trim().length > 0);
  const records = lines.map((line, index) => parseJournalRecord(line, runDirectory, `${journalFile}:${index + 1}`));
  if (records.length === 0) throw new DomainError("run-transfer-invalid", `The journal of run ${manifest.runId} in the archive is empty`, 400);
  const foreign = records.find((record) => record.runId !== manifest.runId);
  if (foreign) throw new DomainError("run-transfer-invalid", `The journal in the archive belongs to run ${foreign.runId}, not to ${manifest.runId}`, 400);
  const events = records.reduce((total, record) => total + record.events.length, 0);
  if (events !== manifest.events) {
    throw new DomainError("run-transfer-invalid", `The manifest names ${manifest.events} events, the journal in the archive has ${events}`, 400);
  }
  return { manifest, staging, records };
};

/** Places the archive's contents under the target's artifacts/; existing ones are the same because of their hash name. */
export const installContents = async (options: { places: RunTransferPlaces; staging: string }): Promise<void> => {
  const source = path.join(options.staging, "artifacts");
  if (!existsSync(source)) return;
  const target = path.join(options.places.dataDirectory, "artifacts");
  await mkdir(target, { recursive: true });
  for (const name of await readdir(source)) {
    if (!existsSync(path.join(target, name))) await rename(path.join(source, name), path.join(target, name));
  }
};

/** Places the archive's session storage at its place on the target; the journal then takes over the records. */
export const installSessionDirectory = async (options: {
  places: RunTransferPlaces;
  runId: string;
  staging: string;
  mode: number;
}): Promise<string | null> => {
  const source = path.join(options.staging, "sessions", options.runId);
  if (!existsSync(source)) return null;
  const target = runTransferSessionDirectory(options.places.dataDirectory, options.runId);
  if (existsSync(target)) throw new DomainError("run-transfer-exists", `The session storage ${target} already exists`, 409);
  await mkdir(path.dirname(target), { recursive: true });
  await rename(source, target);
  await chmod(target, options.mode);
  return target;
};
