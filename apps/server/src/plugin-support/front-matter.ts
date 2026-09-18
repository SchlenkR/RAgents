export const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export const fieldsOf = (file: string, block: string): Map<string, string> => {
  const fields = new Map<string, string>();
  for (const line of block.split("\n")) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator < 0) throw new Error(`${file}: "${line.trim()}" ist kein Schlüssel-Wert-Paar`);
    const key = line.slice(0, separator).trim();
    if (fields.has(key)) throw new Error(`${file}: ${key} steht mehrfach im Kopf`);
    fields.set(key, line.slice(separator + 1).trim().replace(/^"(.*)"$/, "$1"));
  }
  return fields;
};

export const flag = (file: string, key: string, value: string | undefined, fallback = false): boolean => {
  if (value === undefined || value === "") return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`${file}: ${key} muss true oder false sein, nicht "${value}"`);
};

export const numberOf = (file: string, key: string, value: string | undefined): number | undefined => {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${file}: ${key} muss eine Zahl sein, nicht "${value}"`);
  return parsed;
};

export const tagsOf = (file: string, value: string | undefined): readonly string[] | undefined => {
  if (value === undefined) return undefined;
  const tags = value.split(",").map((tag) => tag.trim());
  if (tags.some((tag) => !tag) || new Set(tags).size !== tags.length) {
    throw new Error(`${file}: tags müssen eindeutige, nicht leere Schlagworte sein`);
  }
  return tags;
};

/** Splits a markdown file into its front matter fields and the body after the closing marker. */
export const frontMatterOf = (file: string, raw: string, required: string): { fields: Map<string, string>; body: string } => {
  const head = FRONT_MATTER.exec(raw);
  if (!head) throw new Error(`${file}: es fehlt der ---Kopf mit ${required}`);
  return { fields: fieldsOf(file, head[1]), body: raw.slice(head[0].length) };
};
