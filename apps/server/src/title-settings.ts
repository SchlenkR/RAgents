import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { ModelRuntime } from "@aicontainer/agent";
import { getSupportedThinkingLevels } from "@aicontainer/ai";
import { DomainError } from "@aicontainer/ragents";
import type { TitleModelSelection, TitleModelSettings } from "./title-settings-contract.js";

const preferred = ["google/gemma-4-26b-a4b-it", "qwen/qwen3.8-flash", "openai/gpt-5.4-nano"];
const invalid = (message: string) => new DomainError("title-model-invalid", message, 400);

export class TitleSettingsStore {
  #selection: TitleModelSelection | null;
  #pending: Promise<unknown> = Promise.resolve();

  private constructor(private readonly file: string, private readonly models: TitleModelSettings["models"], value: unknown) {
    this.#selection = this.#validate(value);
  }

  static async create(file: string, runtime: ModelRuntime, defaults: TitleModelSelection | null, provider: string): Promise<TitleSettingsStore> {
    const models = runtime.getModels(provider).filter((model) => model.input.includes("text") && getSupportedThinkingLevels(model).includes("off"))
      .map((model) => ({ provider: model.provider, id: model.id, label: model.name.trim() }));
    models.sort((left, right) => {
      const rank = (id: string) => preferred.includes(id) ? preferred.indexOf(id) : preferred.length;
      return rank(left.id) - rank(right.id) || left.label.localeCompare(right.label);
    });
    if (models.length === 0) throw invalid(`Für ${provider} fehlen Textmodelle ohne Reasoning im Modellkatalog.`);
    let value: unknown;
    try { value = JSON.parse(await readFile(file, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      value = { selection: defaults };
    }
    return new TitleSettingsStore(file, models, value);
  }

  selection = (): TitleModelSelection | null => this.#selection ? { ...this.#selection } : null;

  get(): TitleModelSettings {
    return { selection: this.selection(), models: this.models.map((model) => ({ ...model })) };
  }

  async save(value: unknown): Promise<TitleModelSettings> {
    const selection = this.#validate(value);
    const operation = this.#pending.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      await writeFile(`${this.file}.tmp`, `${JSON.stringify({ selection })}\n`, { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
      this.#selection = selection;
      return this.get();
    });
    this.#pending = operation.catch(() => undefined);
    return operation;
  }

  #validate(value: unknown): TitleModelSelection | null {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== 1 || !("selection" in value)) throw invalid("Erforderlich ist ausschließlich selection mit Modellwahl oder null.");
    const selected = value.selection;
    if (selected === null) return null;
    if (!selected || typeof selected !== "object" || Array.isArray(selected)
      || Object.keys(selected).some((key) => !["provider", "model"].includes(key))
      || !("provider" in selected) || typeof selected.provider !== "string"
      || !("model" in selected) || typeof selected.model !== "string") throw invalid("Die Titelmodellwahl braucht provider und model.");
    if (!this.models.some((model) => model.provider === selected.provider && model.id === selected.model))
      throw invalid(`Das Titelmodell ${selected.provider}/${selected.model} steht nicht zur Wahl; erforderlich ist ein Textmodell ohne Reasoning.`);
    return { provider: selected.provider, model: selected.model };
  }
}
