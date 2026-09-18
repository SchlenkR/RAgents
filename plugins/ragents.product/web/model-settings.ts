import type { ProductModelDraft, ProductModelSettings } from "../model-settings-contract";
import { errorFrom } from "@aicontainer/web/lib/http";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export const productModelSettingsFrom = (value: unknown): ProductModelSettings => {
  if (!record(value) || !Array.isArray(value.models) || !Array.isArray(value.profiles)
    || !value.models.length || !value.profiles.length
    || !value.models.every((model) => record(model) && text(model.id) && text(model.provider)
      && text(model.label) && Array.isArray(model.thinking) && model.thinking.length > 0 && model.thinking.every(text))
    || !value.profiles.every((profile) => record(profile) && text(profile.name) && typeof profile.description === "string"
      && text(profile.provider) && text(profile.model) && text(profile.thinking))) {
    throw new Error("Der Server hat ungültige Modellvorgaben geliefert.");
  }
  const settings = value as unknown as ProductModelSettings;
  const names = settings.profiles.map((profile) => profile.name);
  if (new Set(names).size !== names.length || settings.profiles.some((profile) => !settings.models.some((model) =>
    model.id === profile.model && model.provider === profile.provider && model.thinking.includes(profile.thinking)))) {
    throw new Error("Die Modellvorgaben passen nicht zum verfügbaren Modellkatalog.");
  }
  return settings;
};

export const modelDraftOf = (settings: ProductModelSettings): ProductModelDraft => ({
  profiles: settings.profiles.map(({ name, model, thinking }) => ({ name, model, thinking })),
});

export async function requestProductModelSettings(pluginId: string, options: {
  draft?: ProductModelDraft; signal?: AbortSignal; request?: typeof fetch;
} = {}): Promise<ProductModelSettings> {
  const response = await (options.request ?? fetch)(`/api/plugins/${encodeURIComponent(pluginId)}/model-settings`, {
    signal: options.signal,
    cache: "no-store",
    ...(options.draft ? {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.draft),
    } : {}),
  });
  if (!response.ok) throw await errorFrom(response, "Die Modellvorgaben konnten nicht geladen oder gespeichert werden.");
  return productModelSettingsFrom(await response.json());
}
