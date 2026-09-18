import { createLocalStorageSetting } from "@aicontainer/web/lib/local-storage-setting";

export interface ActorCardSize { width: number; height: number }

export const DEFAULT_ACTOR_CARD_SIZE: ActorCardSize = { width: 720, height: 520 };
export const ACTOR_CARD_SIZE_LIMITS = { minWidth: 240, maxWidth: 2880, minHeight: 260, maxHeight: 2700 };
export const ACTOR_CARD_SIZE_STORAGE_KEY = "ragents.orchestration.actor-card-size";

export function parseActorCardSize(raw: string | null): ActorCardSize {
  if (raw === null) return DEFAULT_ACTOR_CARD_SIZE;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("width" in value) || !("height" in value)
    || !Number.isInteger(value.width) || !Number.isInteger(value.height)
    || typeof value.width !== "number" || typeof value.height !== "number"
    || value.width < ACTOR_CARD_SIZE_LIMITS.minWidth || value.width > ACTOR_CARD_SIZE_LIMITS.maxWidth
    || value.height < 180 || value.height > ACTOR_CARD_SIZE_LIMITS.maxHeight) {
    throw new Error("Die Standardgröße der LLM-Karten ist ungültig. Breite: 240 bis 2880, Höhe: 260 bis 2700 Pixel.");
  }
  return { width: value.width, height: Math.max(ACTOR_CARD_SIZE_LIMITS.minHeight, value.height) };
}

const setting = createLocalStorageSetting({
  changeEvent: "ragents-actor-card-size-change",
  matchesKey: (key) => key === ACTOR_CARD_SIZE_STORAGE_KEY,
  parse: parseActorCardSize,
  serialize: JSON.stringify,
});

export function useActorCardSize(): ActorCardSize {
  return setting.useValue(ACTOR_CARD_SIZE_STORAGE_KEY);
}

export function saveActorCardSize(size: ActorCardSize) {
  if (size.height < ACTOR_CARD_SIZE_LIMITS.minHeight) throw new Error("LLM-Karten benötigen mindestens 260 Pixel Höhe für Verlauf und Eingabe.");
  setting.save(ACTOR_CARD_SIZE_STORAGE_KEY, size);
}
