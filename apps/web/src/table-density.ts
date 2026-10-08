export const DENSITY_STORAGE_KEY = "ragents.density";

export const densityOptions = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "spacious", label: "Spacious" },
] as const;

export type TableDensity = typeof densityOptions[number]["value"];

export function parseTableDensity(value: string | null | undefined): TableDensity {
  if (value === null || value === undefined) return "comfortable";
  if (value === "compact" || value === "comfortable" || value === "spacious") return value;
  throw new Error(`Invalid table spacing in ${DENSITY_STORAGE_KEY}: ${JSON.stringify(value)}. Allowed are compact, comfortable, and spacious.`);
}
