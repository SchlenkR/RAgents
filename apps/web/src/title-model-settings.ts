import { coreContracts } from "@aicontainer/server/api/contracts";
import type { TitleModelSelection, TitleModelSettings } from "../../server/src/title-settings-contract";
import { isRecord } from "./lib/guards";
import { rpc } from "./rpc";
import type { RpcClient } from "./rpc/client";

export const titleModelSettingsChangedEvent = "ragents-title-model-settings-changed";
export const titleSelectionKey = (selection: TitleModelSelection | null): string =>
  selection === null ? "null" : JSON.stringify([selection.provider, selection.model]);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function titleModelSettingsFrom(value: unknown): TitleModelSettings {
  if (!isRecord(value) || !Array.isArray(value.models)
    || !value.models.every((model) => isRecord(model) && text(model.provider) && text(model.id) && text(model.label))
    || (value.selection !== null && (!isRecord(value.selection) || !text(value.selection.provider) || !text(value.selection.model)))) {
    throw new Error("Der Server hat ungültige Einstellungen für Überschriften geliefert.");
  }
  const settings = value as unknown as TitleModelSettings;
  const keys = settings.models.map((model) => titleSelectionKey({ provider: model.provider, model: model.id }));
  if (new Set(keys).size !== keys.length || (settings.selection !== null && !keys.includes(titleSelectionKey(settings.selection)))) {
    throw new Error("Die Einstellungen für Überschriften passen nicht zum verfügbaren Modellkatalog.");
  }
  return settings;
}

export function titleSelectionFromKey(key: string, models: TitleModelSettings["models"]): TitleModelSelection | null {
  if (key === "null") return null;
  const model = models.find((entry) => titleSelectionKey({ provider: entry.provider, model: entry.id }) === key);
  if (!model) throw new Error("Das ausgewählte Modell für Überschriften ist nicht verfügbar.");
  return { provider: model.provider, model: model.id };
}

export function titleModelOptions(models: TitleModelSettings["models"], selection: TitleModelSelection | null, query: string) {
  const search = query.trim().toLocaleLowerCase("de-DE");
  return [
    { value: "null", label: "Keine automatischen Überschriften" },
    ...models.filter((model) => (model.provider === selection?.provider && model.id === selection.model)
      || `${model.label} ${model.id}`.toLocaleLowerCase("de-DE").includes(search))
      .map((model) => ({ value: titleSelectionKey({ provider: model.provider, model: model.id }), label: model.label })),
  ];
}

export async function requestTitleModelSettings(options: {
  selection?: TitleModelSelection | null; signal?: AbortSignal; client?: RpcClient;
} = {}): Promise<TitleModelSettings> {
  const client = options.client ?? rpc;
  const settings = options.selection === undefined
    ? await client.call(coreContracts.settings.titlesRead, {}, { signal: options.signal })
    : await client.call(coreContracts.settings.titlesSave, { value: { selection: options.selection } }, { signal: options.signal });
  return titleModelSettingsFrom(settings);
}
