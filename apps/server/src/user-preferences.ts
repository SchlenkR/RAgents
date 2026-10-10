import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertJsonValue, DomainError, type JsonValue } from "@ragents/engine";
import { isPreferenceKey, PREFERENCE_KEYS, PREFERENCE_VALUE_LIMIT, type PreferenceKey } from "./preferences-contract.js";

const FORMAT_VERSION = 1;
const FIELDS = ["userId", "values", "version"];

type Values = Readonly<Record<string, JsonValue>>;

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

/** One file per user: the ID in hex, so that IDs that differ only in case stay apart on every file system; without a user the anonymous one. */
export const preferenceFileName = (userId: string | null): string =>
  userId === null ? "anonymous.json" : `user-${Buffer.from(userId, "utf8").toString("hex")}.json`;

const assertKey = (key: string): void => {
  if (!isPreferenceKey(key)) throw new DomainError("preference-unknown", `Unknown preference ${key}; known are ${PREFERENCE_KEYS.join(", ")}.`, 400);
};

const storable = (key: PreferenceKey, value: unknown): JsonValue => {
  try {
    assertJsonValue(value, key);
  } catch (cause) {
    throw new DomainError("preference-invalid", `The value for ${key} is not JSON: ${messageOf(cause)}`, 400);
  }
  const size = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (size > PREFERENCE_VALUE_LIMIT) throw new DomainError("preference-too-large", `The value for ${key} has ${size} bytes; at most ${PREFERENCE_VALUE_LIMIT} are allowed.`, 413);
  return value;
};

const parsedJson = (source: string): { readonly value: unknown } | { readonly error: string } => {
  try {
    return { value: JSON.parse(source) as unknown };
  } catch (cause) {
    return { error: messageOf(cause) };
  }
};

const valuesFrom = (source: string, name: string, userId: string | null): Values => {
  const unreadable = (cause: string) => new DomainError("preferences-unreadable",
    `The stored preferences in preferences/${name} cannot be read (${cause}); repair or delete that file in the profile's data directory to reset them.`, 500);
  const parsed = parsedJson(source);
  if ("error" in parsed) throw unreadable(parsed.error);
  const record = parsed.value;
  if (!isRecord(record) || Object.keys(record).sort().join(",") !== FIELDS.join(",")) throw unreadable(`expected the fields ${FIELDS.join(", ")}`);
  if (record.version !== FORMAT_VERSION) throw unreadable(`expected version ${FORMAT_VERSION}, found ${JSON.stringify(record.version)}`);
  if (record.userId !== userId) throw unreadable(`it belongs to the user ${JSON.stringify(record.userId)}`);
  if (!isRecord(record.values)) throw unreadable("values must be an object");
  return record.values as Values;
};

/** The JSON preferences of each user, one file per user under the given folder of the profile's data directory; a damaged file fails only its user's requests and stays as it is. */
export class UserPreferences {
  readonly #directory: string;
  readonly #writes = new Map<string, Promise<void>>();

  constructor(directory: string) {
    this.#directory = directory;
  }

  /** Null when nothing is stored for the key. */
  async read(userId: string | null, key: PreferenceKey): Promise<JsonValue | null> {
    assertKey(key);
    return (await this.#values(userId))[key] ?? null;
  }

  /** Null removes the stored value; keys this host does not know stay in the file untouched. */
  async write(userId: string | null, key: PreferenceKey, value: unknown): Promise<void> {
    assertKey(key);
    const stored = storable(key, value);
    const name = preferenceFileName(userId);
    const written = (this.#writes.get(name) ?? Promise.resolve()).then(async () => {
      const others = Object.entries(await this.#values(userId)).filter(([entry]) => entry !== key);
      await this.#store(name, userId, Object.fromEntries(stored === null ? others : [...others, [key, stored]]));
    });
    const settled = written.catch(() => undefined);
    this.#writes.set(name, settled);
    void settled.then(() => { if (this.#writes.get(name) === settled) this.#writes.delete(name); });
    await written;
  }

  async #values(userId: string | null): Promise<Values> {
    const name = preferenceFileName(userId);
    try {
      return valuesFrom(await readFile(path.join(this.#directory, name), "utf8"), name, userId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  async #store(name: string, userId: string | null, values: Values): Promise<void> {
    const file = path.join(this.#directory, name);
    const temporary = `${file}.tmp-${randomUUID()}`;
    try {
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
      await writeFile(temporary, `${JSON.stringify({ version: FORMAT_VERSION, userId, values })}\n`, { mode: 0o600 });
      await rename(temporary, file);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
