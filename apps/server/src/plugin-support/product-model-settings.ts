import { readFileSync, renameSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DomainError, implement, isThinkingLevel, type AgentProfile, type MethodContribution, type ThinkingLevel } from "@ragents/engine";
import type { ModelChoice } from "./model-choice.js";
import { productModelSettingsContracts, type ProductModelDraft, type ProductModelSettings } from "./product-model-settings-contract.js";

type AgentModelProfile = Extract<AgentProfile, { driver: "agent" }>;

const invalid = (message: string): DomainError => new DomainError("product-model-invalid", message, 400);

const objectOf = (value: unknown, fields: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(`${fields.join(", ")} sind erforderlich.`);
  if (Object.keys(value).some((key) => !fields.includes(key))) throw invalid(`Erlaubt sind nur ${fields.join(", ")}.`);
  return value as Record<string, unknown>;
};

export class ProductModelSettingsStore {
  readonly #file: string;
  readonly #baseProfiles: readonly AgentProfile[];
  readonly #choice: ModelChoice;
  #current: ProductModelDraft;
  #pending: Promise<unknown> = Promise.resolve();
  readonly modelChoice: ModelChoice;

  constructor(file: string, choice: ModelChoice, profiles: readonly AgentProfile[]) {
    this.#file = file;
    this.#choice = choice;
    this.#baseProfiles = profiles.map((profile) => ({ ...profile }));
    let saved: unknown;
    try { saved = JSON.parse(readFileSync(file, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      saved = { profiles: this.#agentProfiles().map(({ name, model, thinking }) => ({ name, model, thinking })) };
    }
    this.#current = this.#validate(saved);
    const store = this;
    this.modelChoice = {
      provider: choice.provider,
      get options() { return choice.options; },
      get selectable() { return choice.selectable; },
      get defaultModel() { return store.#selection("coordinator").model; },
      thinkingOptionsFor: (model) => choice.thinkingOptionsFor(model ?? store.#selection("coordinator").model),
    };
  }

  readonly coordinatorThinking = (): ThinkingLevel => this.#selection("coordinator").thinking;

  readonly profiles = (): AgentProfile[] => this.#baseProfiles.map((profile) => {
    if (profile.driver !== "agent") return { ...profile };
    const selected = this.#selection(profile.name);
    return {
      ...profile, ...selected,
      description: `${selected.model} mit Denktiefe ${selected.thinking}. ${profile.description}`,
    };
  });

  get(): ProductModelSettings {
    return {
      profiles: this.profiles().filter((profile): profile is AgentModelProfile => profile.driver === "agent")
        .map(({ name, description, provider, model, thinking }) => ({ name, description, provider, model, thinking: thinking! })),
      models: this.#choice.options.map((id) => ({
        id, provider: this.#choice.provider, label: `${this.#choice.provider}/${id}`,
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
    if (!selected) throw invalid(`Die Rolle ${name} hat keine Modellvorgabe.`);
    return selected;
  }

  #validate(value: unknown): ProductModelDraft {
    const { profiles } = objectOf(value, ["profiles"]);
    const expected = this.#agentProfiles();
    if (!Array.isArray(profiles) || profiles.length !== expected.length) throw invalid(`Vollständig erforderlich sind die Rollen: ${expected.map((profile) => profile.name).join(", ")}.`);
    const seen = new Set<string>();
    const validated = profiles.map((item: unknown) => {
      const entry = objectOf(item, ["name", "model", "thinking"]);
      const profile = expected.find((candidate) => candidate.name === entry.name);
      if (!profile) throw invalid(`Unbekannte Rolle ${String(entry.name)}.`);
      if (seen.has(profile.name)) throw invalid(`Die Rolle ${profile.name} steht doppelt.`);
      seen.add(profile.name);
      if (profile.provider !== this.#choice.provider) throw invalid(`Die Rolle ${profile.name} verwendet einen anderen Provider.`);
      if (typeof entry.model !== "string" || !this.#choice.options.includes(entry.model)) throw invalid(`Das Modell ${String(entry.model)} steht nicht zur Wahl.`);
      const allowed = this.#choice.thinkingOptionsFor(entry.model);
      if (!isThinkingLevel(entry.thinking) || !allowed.includes(entry.thinking)) throw invalid(`Die Denktiefe ${String(entry.thinking)} ist für ${entry.model} nicht verfügbar (gültig: ${allowed.join(", ")}).`);
      return { name: profile.name, model: entry.model, thinking: entry.thinking };
    });
    return { profiles: expected.map((profile) => validated.find((entry) => entry.name === profile.name)!) };
  }
}

export const productModelSettingsMethods = (pluginId: string, settings: Pick<ProductModelSettingsStore, "get" | "save">): MethodContribution[] => {
  const contracts = productModelSettingsContracts(pluginId);
  return [
    implement(contracts.read, () => settings.get()),
    implement(contracts.save, ({ value }) => settings.save(value)),
  ];
};
