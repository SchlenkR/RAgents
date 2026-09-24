export type StartEntryAction = "skill" | "script";

/** Dieselbe JSON-Form wie im Kern; der Vertrag bleibt importfrei. */
export type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue | undefined };

export interface StartEntryBase {
  id: string;
  owner: string;
  title: string;
  description: string;
  order?: number;
  guide?: string;
  tags?: readonly string[];
  /** Startoptionen, die die Vorlage festlegt: ein Run über sie läuft genau mit diesen Werten. */
  fixedStartOptions?: Readonly<Record<string, JsonValue>>;
}

/** One template of the start page as ragents.plugins.bootstrap publishes it; a script template never carries its source. */
export type StartEntry = StartEntryBase & (
  | { action: "skill"; skill: string; category: string; prompt: string }
  | { action: "script"; coordinator: boolean; category?: string }
);

export type SkillStartEntry = Extract<StartEntry, { action: "skill" }>;
export type ScriptStartEntry = Extract<StartEntry, { action: "script" }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const BASE_FIELDS = ["id", "owner", "title", "description", "order", "guide", "tags", "fixedStartOptions", "action"];

const invalid = (detail: string): Error => new Error(`Die Plugin-Konfiguration enthält eine ungültige Vorlage: ${detail}`);

export const startEntryFrom = (value: unknown): StartEntry => {
  if (!isRecord(value)) throw invalid("kein Objekt");
  if (!text(value.id)) throw invalid("id fehlt");
  const id = value.id;
  if (!text(value.owner) || !text(value.title) || !text(value.description)) throw invalid(`${id}: owner, title und description sind Pflicht`);
  if (value.order !== undefined && typeof value.order !== "number") throw invalid(`${id}: order ist keine Zahl`);
  if (value.guide !== undefined && !text(value.guide)) throw invalid(`${id}: guide ist leer`);
  if (value.tags !== undefined && (!Array.isArray(value.tags)
    || value.tags.some((tag) => !text(tag) || tag !== tag.trim())
    || new Set(value.tags).size !== value.tags.length)) {
    throw invalid(`${id}: tags müssen eindeutige, nicht leere Schlagworte sein`);
  }
  if (value.fixedStartOptions !== undefined && (!isRecord(value.fixedStartOptions) || Object.keys(value.fixedStartOptions).length === 0)) {
    throw invalid(`${id}: fixedStartOptions muss mindestens eine Startoption festlegen`);
  }
  const base: StartEntryBase = {
    id,
    owner: value.owner,
    title: value.title,
    description: value.description,
    ...(value.order !== undefined ? { order: value.order } : {}),
    ...(value.guide !== undefined ? { guide: value.guide } : {}),
    ...(value.tags !== undefined ? { tags: [...value.tags] as string[] } : {}),
    ...(value.fixedStartOptions !== undefined ? { fixedStartOptions: { ...value.fixedStartOptions as Record<string, JsonValue> } } : {}),
  };
  const allowed = (extra: readonly string[]) => {
    const unknown = Object.keys(value).filter((field) => !BASE_FIELDS.includes(field) && !extra.includes(field));
    if (unknown.length > 0) throw invalid(`${id}: unbekannte Felder ${unknown.join(", ")}`);
  };
  switch (value.action) {
    case "skill": {
      allowed(["skill", "prompt", "category"]);
      if (!text(value.skill)) throw invalid(`${id}: skill fehlt`);
      if (!text(value.category) || !value.category.trim() || value.category !== value.category.trim()) throw invalid(`${id}: category muss ein einzelner nicht leerer Text sein`);
      if (!text(value.prompt) || !value.prompt.trim()) throw invalid(`${id}: prompt fehlt oder ist leer`);
      return { ...base, action: "skill", skill: value.skill, category: value.category, prompt: value.prompt };
    }
    case "script":
      allowed(["coordinator", "category"]);
      if (typeof value.coordinator !== "boolean") throw invalid(`${id}: coordinator muss true oder false sein`);
      if (value.category !== undefined && (!text(value.category) || value.category !== value.category.trim())) throw invalid(`${id}: category muss ein einzelner nicht leerer Text sein`);
      return { ...base, action: "script", coordinator: value.coordinator, ...(value.category !== undefined ? { category: value.category } : {}) };
    default:
      throw invalid(`${id}: unbekannte Aktion ${String(value.action)}; gültig sind skill und script`);
  }
};
