import type { RunToolParameter } from "./api";
import { isJsonValue, type JsonValue } from "./bridge";

const parseParameter = (parameter: RunToolParameter, form: FormData): JsonValue | undefined => {
  const raw = String(form.get(parameter.name) ?? "");
  if (parameter.type === "boolean") {
    if (parameter.required) return form.has(parameter.name);
    return raw === "" ? undefined : raw === "true";
  }
  if (raw === "" && !parameter.required) return undefined;
  if (parameter.type === "string") return raw;
  if (!raw.trim()) throw new Error(`${parameter.name}: Bitte einen Wert eingeben.`);
  if (parameter.type === "number" || parameter.type === "integer") {
    const value = Number(raw);
    if (!Number.isFinite(value) || parameter.type === "integer" && !Number.isInteger(value)) {
      throw new Error(`${parameter.name} ist keine gültige ${parameter.type === "integer" ? "Ganzzahl" : "Zahl"}.`);
    }
    return value;
  }
  if (parameter.type === "string[]" && !raw.trimStart().startsWith("[")) {
    return raw.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
  }
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error(`${parameter.name}: Bitte gültiges JSON eingeben.`); }
  if (!isJsonValue(value)) throw new Error(`${parameter.name}: Kein gültiger JSON-Wert.`);
  if (parameter.type === "string[]" && (!Array.isArray(value) || !value.every((entry) => typeof entry === "string"))) {
    throw new Error(`${parameter.name}: Bitte eine Liste aus Texten eingeben.`);
  }
  if (parameter.type === "number[]" && (!Array.isArray(value) || !value.every((entry) => typeof entry === "number"))) {
    throw new Error(`${parameter.name}: Bitte eine JSON-Liste aus Zahlen eingeben.`);
  }
  return value;
};

export const actorFunctionInput = (parameters: readonly RunToolParameter[], form: FormData): Record<string, JsonValue> =>
  Object.fromEntries(parameters.flatMap((parameter) => {
    const value = parseParameter(parameter, form);
    return value === undefined ? [] : [[parameter.name, value]];
  }));
