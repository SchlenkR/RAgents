import { assertJsonValue, type JsonValue } from "@ragents/engine";

const MAX_JSON_BYTES = 250_000;
const MAX_JSON_DEPTH = 24;
const MAX_JSON_KEY_LENGTH = 256;
export const MAX_INVOCATIONS_STATE_BYTES = 8 * 1024 * 1024;

export const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

export const jsonValue = <T>(value: T, label: string): T & JsonValue => {
  assertJsonValue(value, label);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES)
    throw new Error(`${label} ist größer als ${MAX_JSON_BYTES} Byte.`);
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > MAX_JSON_DEPTH)
      throw new Error(`${label} ist tiefer als ${MAX_JSON_DEPTH} Ebenen verschachtelt.`);
    if (Array.isArray(current.value)) {
      current.value.forEach((entry) => pending.push({ value: entry, depth: current.depth + 1 }));
      continue;
    }
    if (current.value && typeof current.value === "object") {
      Object.entries(current.value).forEach(([key, entry]) => {
        if (key.length > MAX_JSON_KEY_LENGTH)
          throw new Error(`${label} enthält einen Schlüssel mit mehr als ${MAX_JSON_KEY_LENGTH} Zeichen.`);
        pending.push({ value: entry, depth: current.depth + 1 });
      });
    }
  }
  return value;
};
