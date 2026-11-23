import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { ModelRuntime } from "@ragents/agent";
import { getSupportedThinkingLevels } from "@ragents/ai";
import { DomainError } from "@ragents/engine";
import { modelLabel } from "./plugin-support/model-aliases.js";
import type { TitleModelSelection, TitleModelSettings } from "./title-settings-contract.js";

const preferred = ["google/gemma-4-26b-a4b-it", "qwen/qwen3.8-flash", "openai/gpt-5.4-nano"];
const invalid = (message: string) => new DomainError("title-model-invalid", message, 400);

export class TitleSettingsStore {
  #selection: TitleModelSelection | null;
  #pending: Promise<unknown> = Promise.resolve();

  private constructor(private readonly file: string, private readonly models: TitleModelSettings["models"], selection: TitleModelSelection | null) {
    this.#selection = selection;
  }

  static async create(file: string, runtime: ModelRuntime, defaultId: string): Promise<TitleSettingsStore> {
    const catalog = runtime.getModels();
    const suitable = catalog.filter((model) => model.input.includes("text") && getSupportedThinkingLevels(model).includes("off"));
    const models = suitable.map((model) => ({
      provider: model.provider,
      id: model.id,
      label: suitable.some((other) => other !== model && other.name === model.name)
        ? modelLabel(model.provider, model.id) : model.name.trim(),
    }));
    models.sort((left, right) => {
      const rank = (id: string) => preferred.includes(id) ? preferred.indexOf(id) : preferred.length;
      return rank(left.id) - rank(right.id) || left.label.localeCompare(right.label);
    });

    let selection: TitleModelSelection | null = null;
    if (defaultId) {
      const matches = catalog.filter((model) => model.id === defaultId);
      const [model] = matches;
      if (!model) throw invalid(`TITLE_MODEL: model ${defaultId} is not configured; configured model ids: ${catalog.map((entry) => entry.id).join(", ") || "none"}`);
      if (matches.length > 1) throw invalid(`TITLE_MODEL: model ${defaultId} is ambiguous across providers ${matches.map((entry) => entry.provider).join(", ")}. Choose a unique model id or define a unique MODEL_ALIASES name.`);
      if (!suitable.includes(model)) throw invalid(`TITLE_MODEL: model ${defaultId} must accept text and support reasoning off; suitable model ids: ${suitable.map((entry) => entry.id).join(", ") || "none"}`);
      selection = { provider: model.provider, model: model.id };
    }
    const store = new TitleSettingsStore(file, models, selection);
    try { store.#selection = store.#parsed(JSON.parse(await readFile(file, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return store;
  }

  selection = (): TitleModelSelection | null => {
    try { return this.#validate({ selection: this.#selection }); }
    catch (error) {
      if (!(error instanceof DomainError)) throw error;
      throw invalid(`Cannot use the stored title model from title-settings.json. Choose another model or turn titles off in Settings, Models, Titles. ${error.message}`);
    }
  };

  get(): TitleModelSettings {
    return { selection: this.#selection ? { ...this.#selection } : null, models: this.models.map((model) => ({ ...model })) };
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

  #parsed(value: unknown): TitleModelSelection | null {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== 1 || !("selection" in value)) throw invalid("Only selection with a model choice or null is allowed.");
    const selected = value.selection;
    if (selected === null) return null;
    if (!selected || typeof selected !== "object" || Array.isArray(selected)
      || Object.keys(selected).some((key) => !["provider", "model"].includes(key))
      || !("provider" in selected) || typeof selected.provider !== "string"
      || !("model" in selected) || typeof selected.model !== "string") throw invalid("The title model choice needs provider and model.");
    return { provider: selected.provider, model: selected.model };
  }

  #validate(value: unknown): TitleModelSelection | null {
    const selected = this.#parsed(value);
    if (selected === null) return null;
    if (!this.models.some((model) => model.provider === selected.provider && model.id === selected.model))
      throw invalid(`The title model ${selected.provider}/${selected.model} is not available for selection; a text model supporting reasoning off is required; configured suitable model ids: ${this.models.filter((model) => model.provider === selected.provider).map((model) => model.id).join(", ") || "none"}.`);
    return { provider: selected.provider, model: selected.model };
  }
}
