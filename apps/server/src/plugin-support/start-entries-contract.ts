export type StartEntryAction = "skill" | "script";

/** The same JSON shape as in the core; the contract stays free of imports. */
export type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue | undefined };

export interface StartEntryBase {
  id: string;
  owner: string;
  title: string;
  description: string;
  order?: number;
  guide?: string;
  tags?: readonly string[];
  /** Start options the template fixes: a run started from it runs with exactly these values. */
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

const invalid = (detail: string): Error => new Error(`The plugin configuration contains an invalid template: ${detail}`);

export const startEntryFrom = (value: unknown): StartEntry => {
  if (!isRecord(value)) throw invalid("not an object");
  if (!text(value.id)) throw invalid("id is missing");
  const id = value.id;
  if (!text(value.owner) || !text(value.title) || !text(value.description)) throw invalid(`${id}: owner, title and description are required`);
  if (value.order !== undefined && typeof value.order !== "number") throw invalid(`${id}: order is not a number`);
  if (value.guide !== undefined && !text(value.guide)) throw invalid(`${id}: guide is empty`);
  if (value.tags !== undefined && (!Array.isArray(value.tags)
    || value.tags.some((tag) => !text(tag) || tag !== tag.trim())
    || new Set(value.tags).size !== value.tags.length)) {
    throw invalid(`${id}: tags must be unique, non-empty keywords`);
  }
  if (value.fixedStartOptions !== undefined && (!isRecord(value.fixedStartOptions) || Object.keys(value.fixedStartOptions).length === 0)) {
    throw invalid(`${id}: fixedStartOptions must fix at least one start option`);
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
    if (unknown.length > 0) throw invalid(`${id}: unknown fields ${unknown.join(", ")}`);
  };
  switch (value.action) {
    case "skill": {
      allowed(["skill", "prompt", "category"]);
      if (!text(value.skill)) throw invalid(`${id}: skill is missing`);
      if (!text(value.category) || !value.category.trim() || value.category !== value.category.trim()) throw invalid(`${id}: category must be a single non-empty text`);
      if (!text(value.prompt) || !value.prompt.trim()) throw invalid(`${id}: prompt is missing or empty`);
      return { ...base, action: "skill", skill: value.skill, category: value.category, prompt: value.prompt };
    }
    case "script":
      allowed(["coordinator", "category"]);
      if (typeof value.coordinator !== "boolean") throw invalid(`${id}: coordinator must be true or false`);
      if (value.category !== undefined && (!text(value.category) || value.category !== value.category.trim())) throw invalid(`${id}: category must be a single non-empty text`);
      return { ...base, action: "script", coordinator: value.coordinator, ...(value.category !== undefined ? { category: value.category } : {}) };
    default:
      throw invalid(`${id}: unknown action ${String(value.action)}; valid are skill and script`);
  }
};
