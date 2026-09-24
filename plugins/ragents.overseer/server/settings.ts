import { renameSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DomainError, isThinkingLevel, type CatalogModel, type ModelSelection, type Orchestration } from "@ragents/engine";
import type { GlobalChatPolicy } from "@ragents/host/ragents/global-chat.js";
import type { OverseerSettings } from "../contract.js";
import { OVERSEER_PLUGIN_ID, OVERSEER_RUN_ID } from "../contract.js";

type Selection = ModelSelection & { thinking: NonNullable<ModelSelection["thinking"]> };
type Model = CatalogModel & { input: readonly string[] };

export class OverseerModelSettings {
  private current: Selection | undefined;
  private models: readonly Model[] = [];
  private requiredInputs: () => readonly string[] = () => [];
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  readonly initialize: NonNullable<GlobalChatPolicy["model"]>["initialize"] = async (models, initial, requiredInputs) => {
    this.models = models;
    this.requiredInputs = requiredInputs;
    let saved: unknown;
    try { saved = JSON.parse(await readFile(this.file, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist(this.validate(initial));
      return;
    }
    this.current = this.validate(saved);
  };

  readonly selection = (): Selection => {
    if (!this.current) throw new DomainError("overseer-model-unavailable", "Der übergeordnete Koordinator hat keine konfigurierte Modellauswahl.", 400);
    return { ...this.validate(this.current) };
  };

  get(): OverseerSettings {
    return {
      ...this.selection(),
      models: this.models.map((model) => ({ id: model.model, provider: model.provider, label: model.label, thinking: [...model.thinking] })),
    };
  }

  save(value: unknown): Promise<OverseerSettings> {
    const operation = this.pending.then(async () => {
      if (!this.current) this.selection();
      const selected = this.validate(value);
      await this.persist(selected);
      return this.get();
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  readonly forTurn = (runtime: Orchestration, actorId: string, turnId: string): ModelSelection => {
    const selection = this.selection();
    runtime.replacePluginState({ actorId: runtime.view(OVERSEER_RUN_ID).ownerId, commandId: `overseer-model:${turnId}` }, OVERSEER_RUN_ID, {
      pluginId: OVERSEER_PLUGIN_ID, scope: { kind: "actor", actorId }, state: { turnId, ...selection },
    });
    return selection;
  };

  private async persist(selected: Selection): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(selected), { mode: 0o600 });
    this.validate(selected);
    renameSync(`${this.file}.tmp`, this.file);
    this.current = selected;
  }

  private validate(value: unknown): Selection {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("overseer-model-invalid", "provider, model und thinking sind erforderlich.", 400);
    const selected = value as Record<string, unknown>;
    if (Object.keys(selected).some((key) => key !== "provider" && key !== "model" && key !== "thinking")) throw new DomainError("overseer-model-invalid", "Erlaubt sind nur provider, model und thinking.", 400);
    const model = this.models.find((entry) => entry.provider === selected.provider && entry.model === selected.model);
    if (!model) throw new DomainError("overseer-model-unknown", `Unbekanntes Modell. Gültig: ${this.models.map((entry) => `${entry.provider}/${entry.model}`).join(", ") || "keine"}.`, 400);
    if (!isThinkingLevel(selected.thinking) || !model.thinking.includes(selected.thinking)) throw new DomainError("overseer-thinking-unsupported", `Reasoning ${String(selected.thinking)} ist für ${model.provider}/${model.model} nicht verfügbar. Gültig: ${model.thinking.join(", ") || "keine"}.`, 400);
    const missing = this.requiredInputs().filter((kind) => !model.input.includes(kind));
    if (missing.length > 0) throw new DomainError("overseer-history-unsupported", `Das Gespräch enthält bereits ${missing.join(", ")}-Anhänge. ${model.provider}/${model.model} kann diese nicht verarbeiten; wähle ein passendes Modell.`, 400);
    return { provider: model.provider, model: model.model, thinking: selected.thinking };
  }
}
