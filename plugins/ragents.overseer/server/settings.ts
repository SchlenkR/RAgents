import { renameSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DomainError, isThinkingLevel, type CatalogModel, type ModelSelection, type Orchestration } from "@ragents/engine";
import type { GlobalChatPolicy } from "@ragents/host/ragents/global-chat.js";
import type { OverseerModelSelection, OverseerSettings } from "../contract.js";
import { OVERSEER_PLUGIN_ID } from "../contract.js";

type Selection = ModelSelection & { thinking: NonNullable<ModelSelection["thinking"]> };
type Model = CatalogModel & { input: readonly string[] };

export class OverseerModelSettings {
  private current: OverseerModelSelection | undefined;
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
      const selected = this.parsed(initial);
      try { this.validate(selected); }
      catch (error) {
        if (!(error instanceof DomainError)) throw error;
        this.current = selected;
        return;
      }
      await this.persist(selected);
      return;
    }
    this.current = this.parsed(saved);
  };

  readonly selection = (): Selection => {
    const stored = this.stored();
    try { return this.validate(stored); }
    catch (error) {
      if (!(error instanceof DomainError)) throw error;
      throw new DomainError(error.code, `The global coordinator cannot use its stored model selection; choose another model in its model settings. ${error.message}`, error.status);
    }
  };

  get(): OverseerSettings {
    return {
      ...this.stored(),
      models: this.models.map((model) => ({ id: model.model, provider: model.provider, label: model.label, thinking: [...model.thinking] })),
    };
  }

  save(value: unknown): Promise<OverseerSettings> {
    const operation = this.pending.then(async () => {
      this.stored();
      const selected = this.validate(value);
      await this.persist(selected);
      return this.get();
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  readonly forTurn = (runtime: Orchestration, runId: string, actorId: string, turnId: string): ModelSelection => {
    const selection = this.selection();
    runtime.replacePluginState({ actorId: runtime.view(runId).ownerId, commandId: `overseer-model:${turnId}` }, runId, {
      pluginId: OVERSEER_PLUGIN_ID, scope: { kind: "actor", actorId }, state: { turnId, ...selection },
    });
    return selection;
  };

  private async persist(selected: OverseerModelSelection): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(selected), { mode: 0o600 });
    this.validate(selected);
    renameSync(`${this.file}.tmp`, this.file);
    this.current = selected;
  }

  private stored(): OverseerModelSelection {
    if (!this.current) throw new DomainError("overseer-model-unavailable", "The global coordinator has no configured model selection.", 400);
    return { ...this.current };
  }

  private parsed(value: unknown): OverseerModelSelection {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("overseer-model-invalid", "provider, model and thinking are required.", 400);
    const selected = value as Record<string, unknown>;
    if (Object.keys(selected).some((key) => key !== "provider" && key !== "model" && key !== "thinking")) throw new DomainError("overseer-model-invalid", "Only provider, model and thinking are allowed.", 400);
    const { provider, model, thinking } = selected;
    if (typeof provider !== "string" || typeof model !== "string" || typeof thinking !== "string") throw new DomainError("overseer-model-invalid", "provider, model and thinking are required.", 400);
    return { provider, model, thinking };
  }

  private validate(value: unknown): Selection {
    const selected = this.parsed(value);
    const model = this.models.find((entry) => entry.provider === selected.provider && entry.model === selected.model);
    if (!model) throw new DomainError("overseer-model-unknown", `Unknown model ${selected.provider}/${selected.model}. Valid: ${this.models.map((entry) => `${entry.provider}/${entry.model}`).join(", ") || "none"}.`, 400);
    if (!isThinkingLevel(selected.thinking) || !model.thinking.includes(selected.thinking)) throw new DomainError("overseer-thinking-unsupported", `Reasoning ${selected.thinking} is not available for ${model.provider}/${model.model}. Valid: ${model.thinking.join(", ") || "none"}.`, 400);
    const missing = this.requiredInputs().filter((kind) => !model.input.includes(kind));
    if (missing.length > 0) throw new DomainError("overseer-history-unsupported", `The conversation already contains ${missing.join(", ")} attachments. ${model.provider}/${model.model} cannot process them; choose a suitable model.`, 400);
    return { provider: model.provider, model: model.model, thinking: selected.thinking };
  }
}
