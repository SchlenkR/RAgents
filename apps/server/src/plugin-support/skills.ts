import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parseFrontmatter, type Skill } from "@ragents/agent";
import type { StartEntryContribution } from "@ragents/engine";
import { flag, FRONT_MATTER, numberOf, tagsOf } from "./front-matter.js";
import type { DeclaredEnvironment } from "./plugin-config.js";

export type SkillStartEntry = Extract<StartEntryContribution, { action: "skill" }>;

export interface FolderSkills {
  readonly startEntries: readonly SkillStartEntry[];
  readonly paths: readonly string[];
}

export const skillEnvDescriptors = [
  { key: "SKILLS_DIR", source: "environment" },
] as const;

/** The alias under which every skill folder is readable, whichever machine a run works on. */
export const SKILLS_ALIAS = "@skills";

/** A skill is reached as `@skills/<name>`; its name is its folder name and unique in the profile. */
export const skillRootAlias = (name: string): string => `${SKILLS_ALIAS}/${name}`;

type SkillEnvironment = DeclaredEnvironment<(typeof skillEnvDescriptors)[number]["key"]>;

/** Reads and checks the SKILL.md of a skill folder; the one parser for templates and the skills of agents. */
const readSkill = (directory: string): { skill: Skill; start: (idPrefix: string) => SkillStartEntry | undefined } => {
  const file = path.join(directory, "SKILL.md");
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(`Dem Skill ${directory} fehlt die SKILL.md`);
  const raw = readFileSync(file, "utf8");
  if (!FRONT_MATTER.test(raw)) throw new Error(`${file}: es fehlt der ---Kopf mit name und description`);
  const { frontmatter, body } = parseFrontmatter(raw);
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) throw new Error(`${file}: Kopf muss ein Objekt sein`);
  const metadata = ["license", "compatibility", "metadata", "allowed-tools"];
  const fields = new Map(Object.entries(frontmatter).filter(([key]) => !metadata.includes(key)).map(([key, value]) => {
    const flagField = ["start", "disable-model-invocation", "user-invokable"].includes(key);
    if (flagField && typeof value !== "boolean") throw new Error(`${file}: ${key} muss true oder false sein`);
    if (value === null) return [key, ""];
    if (typeof value !== "string" && !(flagField && typeof value === "boolean") && !(key === "order" && typeof value === "number")) {
      throw new Error(`${file}: ${key} hat einen ungültigen Wert`);
    }
    return [key, String(value)];
  }));
  const allowed = ["name", "description", "start", "title", "category", "order", "tags", "guide", "prompt", "disable-model-invocation", "user-invokable"];
  const unknown = [...fields.keys()].filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${file}: unbekannte Kopfzeilen ${unknown.join(", ")}`);
  const name = fields.get("name");
  if (!name) throw new Error(`${file}: name fehlt`);
  if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`${file}: name ist kein gültiger Skillname`);
  if (name !== path.basename(directory)) throw new Error(`${file}: name muss dem Skill-Ordner entsprechen`);
  const description = fields.get("description");
  if (!description) throw new Error(`${file}: description fehlt`);
  if (!body.trim()) throw new Error(`${file}: Skill-Anleitung ist leer`);
  const disableModelInvocation = flag(file, "disable-model-invocation", fields.get("disable-model-invocation"));
  flag(file, "user-invokable", fields.get("user-invokable"));
  const order = numberOf(file, "order", fields.get("order"));
  const tags = tagsOf(file, fields.get("tags"));
  const skill: Skill = {
    name, description, filePath: path.resolve(file), baseDir: path.resolve(directory), location: `${skillRootAlias(name)}/SKILL.md`, disableModelInvocation,
  };
  if (!flag(file, "start", fields.get("start"))) return { skill, start: () => undefined };
  const title = fields.get("title");
  if (!title) throw new Error(`${file}: title fehlt`);
  const category = fields.get("category");
  if (!category) throw new Error(`${file}: category fehlt`);
  const prompt = fields.get("prompt") ?? body.trim();
  if (!prompt.trim()) throw new Error(`${file}: prompt ist leer`);
  const guide = fields.get("guide");
  if (guide !== undefined && !guide) throw new Error(`${file}: guide ist leer`);
  return {
    skill,
    start: (idPrefix) => ({
      id: `${idPrefix}.${name}`,
      action: "skill",
      skill: name,
      title,
      description,
      category,
      prompt,
      ...(order !== undefined ? { order } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(guide !== undefined ? { guide } : {}),
    }),
  };
};

/** The skill of a skill folder as an agent sees it. */
export const skillOfDirectory = (directory: string): Skill => readSkill(directory).skill;

export const skillsFromDirectory = (directory: string, idPrefix: string): FolderSkills => {
  const resolved = path.resolve(directory);
  let entries;
  try {
    entries = readdirSync(resolved, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Das Skill-Verzeichnis ${resolved} ist nicht lesbar (${error instanceof Error ? error.message : String(error)})`);
  }
  const stray = entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
  if (stray.length > 0) throw new Error(`${resolved} enthält Dateien statt Skill-Ordner: ${stray.join(", ")}`);
  const paths = entries.map((entry) => path.join(resolved, entry.name)).sort();
  if (paths.length === 0) throw new Error(`${resolved} enthält keinen Skill-Ordner`);
  const startEntries = paths.flatMap((skillPath) => {
    const entry = readSkill(skillPath).start(idPrefix);
    return entry ? [entry] : [];
  });
  return { startEntries, paths };
};

export const skillsFromEnvironment = (env: SkillEnvironment, idPrefix: string): FolderSkills => {
  const directory = env.optional("SKILLS_DIR");
  return directory ? skillsFromDirectory(directory, idPrefix) : { startEntries: [], paths: [] };
};
