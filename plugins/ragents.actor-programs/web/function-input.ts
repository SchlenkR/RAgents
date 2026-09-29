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
  if (!raw.trim()) throw new Error(`${parameter.name}: Please enter a value.`);
  if (parameter.type === "number" || parameter.type === "integer") {
    const value = Number(raw);
    if (!Number.isFinite(value) || parameter.type === "integer" && !Number.isInteger(value)) {
      throw new Error(`${parameter.name} is not a valid ${parameter.type === "integer" ? "integer" : "number"}.`);
    }
    return value;
  }
  if (parameter.type === "string[]" && !raw.trimStart().startsWith("[")) {
    return raw.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
  }
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error(`${parameter.name}: Please enter valid JSON.`); }
  if (!isJsonValue(value)) throw new Error(`${parameter.name}: Not a valid JSON value.`);
  if (parameter.type === "string[]" && (!Array.isArray(value) || !value.every((entry) => typeof entry === "string"))) {
    throw new Error(`${parameter.name}: Please enter a list of texts.`);
  }
  if (parameter.type === "number[]" && (!Array.isArray(value) || !value.every((entry) => typeof entry === "number"))) {
    throw new Error(`${parameter.name}: Please enter a JSON list of numbers.`);
  }
  return value;
};

export const actorFunctionInput = (parameters: readonly RunToolParameter[], form: FormData): Record<string, JsonValue> =>
  Object.fromEntries(parameters.flatMap((parameter) => {
    const value = parseParameter(parameter, form);
    return value === undefined ? [] : [[parameter.name, value]];
  }));
