import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { DomainError, schemaComplaints, type JsonValue } from "@ragents/engine";
import type { AppContract } from "./app-project.js";
import { choicesOf, parameterKindOf } from "./parameter-kinds.js";

/** A run script's parameters as its contract declares them: a closed object of named values, required or optional. */
export type ScriptParameters = {
  readonly type: "object";
  readonly properties: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
};

const isRecord = (value: unknown): value is Record<string, JsonValue> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The parameters of a run script's setup contract; a run script without them, or with nested values, is refused. */
export const scriptParametersOf = (contract: AppContract, entryId: string): ScriptParameters => {
  const declared = contract.parameters;
  if (!contract.input || !declared)
    throw new Error(`The run script ${entryId} declares no parameters; its setup contract needs input and parameters, Type.Object({}) for a script without parameters.`);
  if (declared.type !== "object" || !isRecord(declared.properties ?? {}))
    throw new Error(`The parameters of the run script ${entryId} must be a Type.Object of named values.`);
  const properties = (declared.properties ?? {}) as Record<string, Record<string, JsonValue>>;
  const invalid = Object.entries(properties).filter(([, schema]) => !isRecord(schema) || parameterKindOf(schema) === undefined).map(([name]) => name);
  if (invalid.length)
    throw new Error(`The parameters ${invalid.join(", ")} of the run script ${entryId} are not plain values: a parameter is a string, a number, an integer, a boolean or a choice of strings, never an object or an array.`);
  const required = Array.isArray(declared.required) ? declared.required.filter((name): name is string => typeof name === "string") : [];
  return { type: "object", properties, required, additionalProperties: false };
};

const kindLabel = (schema: Readonly<Record<string, JsonValue>>): string => {
  const kind = parameterKindOf(schema);
  return kind === "choice" ? `one of ${choicesOf(schema).join(", ")}` : kind ?? "value";
};

/** The parameters as a caller reads them in an error: name, kind and whether it is required. */
export const parameterList = (parameters: ScriptParameters): string => {
  const names = Object.keys(parameters.properties);
  return names.length === 0 ? "none" : names.map((name) => `${name} (${kindLabel(parameters.properties[name]!)}, ${parameters.required.includes(name) ? "required" : "optional"})`).join("; ");
};

/** The parameters of a start, checked against the declaration; a missing value is an empty object. */
export const checkedParameters = (parameters: ScriptParameters, value: unknown, entryId: string): Readonly<Record<string, JsonValue>> => {
  const given = value === undefined || value === null ? {} : value;
  if (!Value.Check(parameters as unknown as TSchema, given))
    throw new DomainError("parameters-invalid", `The parameters of the run script ${entryId} are invalid: ${schemaComplaints(parameters, given, "parameters")}. Its parameters: ${parameterList(parameters)}.`, 400);
  return given as Readonly<Record<string, JsonValue>>;
};
