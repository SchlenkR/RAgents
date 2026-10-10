/** The keys of the per-user preference store; a key outside this list is refused. */
export const PREFERENCE_KEYS = ["start.layout"] as const;

export type PreferenceKey = typeof PREFERENCE_KEYS[number];

/** The largest value per key, measured as UTF-8 JSON text. */
export const PREFERENCE_VALUE_LIMIT = 32 * 1024;

export const isPreferenceKey = (key: string): key is PreferenceKey => PREFERENCE_KEYS.some((known) => known === key);
