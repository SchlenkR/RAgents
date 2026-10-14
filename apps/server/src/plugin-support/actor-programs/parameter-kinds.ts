/** What a run script parameter holds; the host checks a declaration by it and the generated form shows one field per kind. */
export type ParameterKind = "string" | "model" | "integer" | "number" | "boolean" | "choice";

type ParameterSchema = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStrings = (value: unknown): value is readonly string[] => Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string");

/** The strings of a choice, from enum or from anyOf of const strings; none for any other parameter. */
export const choicesOf = (schema: ParameterSchema): readonly string[] => {
  if (isStrings(schema.enum)) return schema.enum;
  const consts = Array.isArray(schema.anyOf) ? schema.anyOf.map((entry) => isRecord(entry) ? entry.const : undefined) : [];
  return isStrings(consts) ? consts : [];
};

export const parameterKindOf = (schema: ParameterSchema): ParameterKind | undefined => {
  if (choicesOf(schema).length > 0 && (schema.type === undefined || schema.type === "string")) return "choice";
  if (schema.type === "string") return schema.format === "model" ? "model" : "string";
  if (schema.type === "integer" || schema.type === "number" || schema.type === "boolean") return schema.type;
  return undefined;
};
