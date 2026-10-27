import { readFileSync, renameSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DomainError, implement, isThinkingLevel, type AgentProfile, type MethodContribution, type ThinkingLevel } from "@ragents/engine";
import { modelLabel } from "./model-aliases.js";
import type { ModelChoice } from "./model-choice.js";
import { productModelSettingsContracts, type ProductModelDraft, type ProductModelSettings } from "./product-model-settings-contract.js";

type AgentModelProfile = Extract<AgentProfile, { driver: "agent" }>;

const invalid = (message: string): DomainError => new DomainError("product-model-invalid", message, 400);

const objectOf = (value: unknown, fields: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(`${fields.join(", ")} are required.`);
  if (Object.keys(value).some((key) => !fields.includes(key))) throw invalid(`Only ${fields.join(", ")} are allowed.`);
  return value as Record<string, unknown>;
};

export class ProductModelSettingsStore {
  readonly #file: string;
  readonly #baseProfiles: readonly AgentProfile[];
  readonly #choice: ModelChoice;
  #current: ProductModelDraft;
  #stored = false;
  #pending: Promise<unknown> = Promise.resolve();
  readonly modelChoice: ModelChoice;

  constructor(file: string, choice: ModelChoice, profiles: readonly AgentProfile[]) {
    this.#file = file;
    this.#choice = choice;
    this.#baseProfiles = profiles.map((profile) => ({ ...profile }));
    for (const profile of this.#agentProfiles()) {
      if (profile.provider !== choice.provider) throw invalid(`The role ${profile.name} uses a different provider.`);
    }
    let saved: unknown;
    try { saved = JSON.parse(readFileSync(file, "utf8")); this.#stored = true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      saved = this.#validate({ profiles: this.#agentProfiles().map(({ name, model, thinking }) => ({ name, model, thinking })) });
    }
    this.#current = this.#parsed(saved);
    const store = this;
    this.modelChoice = {
      provider: choice.provider,
      get options() { return choice.options; },
      get selectable() { return choice.selectable; },
      get defaultModel() { return store.#selection("coordinator").model; },
      thinkingOptionsFor: (model) => {
        const selected = store.#selection("coordinator");
        const id = model ?? selected.model;
        if (!choice.options.includes(id)) return [];
        const allowed = choice.thinkingOptionsFor(id);
        return model === null && !allowed.includes(selected.thinking) ? [] : allowed;
      },
      ...(choice.defaultThinkingFor ? { defaultThinkingFor: choice.defaultThinkingFor } : {}),
    };
  }

  readonly coordinatorThinking = (): ThinkingLevel => this.#selection("coordinator").thinking;

  readonly profiles = (): AgentProfile[] => this.#baseProfiles.map((profile) => {
    if (profile.driver !== "agent") return { ...profile };
    const selected = this.#selection(profile.name);
    return {
      ...profile, ...selected,
      description: `${selected.model} with thinking level ${selected.thinking}. ${profile.description}`,
      ...(this.#stored ? { storedDefault: "From model-settings.json; change it in Settings, Models." } : {}),
    };
  });

  get(): ProductModelSettings {
    return {
      profiles: this.profiles().filter((profile): profile is AgentModelProfile => profile.driver === "agent")
        .map(({ name, description, provider, model, thinking }) => ({ name, description, provider, model, thinking: thinking! })),
      models: this.#choice.options.map((id) => ({
        id, provider: this.#choice.provider, label: modelLabel(this.#choice.provider, id),
        thinking: [...this.#choice.thinkingOptionsFor(id)],
      })),
    };
  }

  async save(value: unknown): Promise<ProductModelSettings> {
    const selected = this.#validate(value);
    const operation = this.#pending.then(async () => {
      await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
      await writeFile(`${this.#file}.tmp`, JSON.stringify(selected), { mode: 0o600 });
      renameSync(`${this.#file}.tmp`, this.#file);
      this.#current = selected;
      this.#stored = true;
      return this.get();
    });
    this.#pending = operation.catch(() => undefined);
    return operation;
  }

  #agentProfiles(): AgentModelProfile[] {
    return this.#baseProfiles.filter((profile): profile is AgentModelProfile => profile.driver === "agent");
  }

  #selection(name: string): ProductModelDraft["profiles"][number] {
    const selected = this.#current.profiles.find((profile) => profile.name === name);
    if (!selected) throw invalid(`The role ${name} has no model default.`);
    return selected;
  }

  #parsed(value: unknown): ProductModelDraft {
    const { profiles } = objectOf(value, ["profiles"]);
    const expected = this.#agentProfiles();
    if (!Array.isArray(profiles) || profiles.length !== expected.length) throw invalid(`All of these roles are required: ${expected.map((profile) => profile.name).join(", ")}.`);
    const seen = new Set<string>();
    const validated = profiles.map((item: unknown) => {
      const entry = objectOf(item, ["name", "model", "thinking"]);
      const profile = expected.find((candidate) => candidate.name === entry.name);
      if (!profile) throw invalid(`Unknown role ${String(entry.name)}.`);
      if (seen.has(profile.name)) throw invalid(`The role ${profile.name} is listed twice.`);
      seen.add(profile.name);
      if (typeof entry.model !== "string" || typeof entry.thinking !== "string") throw invalid(`The role ${profile.name} needs model and thinking strings.`);
      return { name: profile.name, model: entry.model, thinking: entry.thinking as ThinkingLevel };
    });
    return { profiles: expected.map((profile) => validated.find((entry) => entry.name === profile.name)!) };
  }

  #validate(value: unknown): ProductModelDraft {
    const parsed = this.#parsed(value);
    for (const entry of parsed.profiles) {
      if (!this.#choice.options.includes(entry.model)) throw invalid(`The model ${entry.model} of role ${entry.name} is not available for selection.`);
      const allowed = this.#choice.thinkingOptionsFor(entry.model);
      if (!isThinkingLevel(entry.thinking) || !allowed.includes(entry.thinking)) throw invalid(`The thinking level ${entry.thinking} of role ${entry.name} is not available for ${entry.model} (valid: ${allowed.join(", ")}).`);
    }
    return parsed;
  }
}

export const productModelSettingsMethods = (pluginId: string, settings: Pick<ProductModelSettingsStore, "get" | "save">): MethodContribution[] => {
  const contracts = productModelSettingsContracts(pluginId);
  return [
    implement(contracts.read, () => settings.get()),
    implement(contracts.save, ({ value }) => settings.save(value)),
  ];
};
