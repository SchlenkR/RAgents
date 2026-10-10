import type { JsonValue } from "@ragents/engine/src/domain/json";
import type { StartWidgetSetting, StartWidgetSettings, StartWidgetSettingValues } from "../PluginRegistry";

/** The most characters a text setting holds. */
export const SETTING_TEXT_LIMIT = 200;

/** What the viewer's layout stores for one widget, by setting key; it is checked against the widget's settings whenever the widget renders. */
export type StoredWidgetSettings = Readonly<Record<string, JsonValue>>;

/** The values a widget renders with and the stored values it could not use. */
export interface ResolvedWidgetSettings {
  readonly values: StartWidgetSettingValues;
  /** One sentence per stored value that its setting rejects; the setting's default applies instead. */
  readonly problems: readonly string[];
}

/** A widget without settings declares these. */
export const NO_SETTINGS: StartWidgetSettings = {};

const SETTING_KEY = /^[A-Za-z][A-Za-z0-9]*$/;

const NOTHING_STORED: StoredWidgetSettings = {};

const isBlank = (text: unknown) => typeof text !== "string" || text.trim() === "";

/** Why a value does not fit a setting, as the end of a sentence about the value, or undefined when it fits. */
export function settingValueProblem(setting: StartWidgetSetting, value: JsonValue): string | undefined {
  switch (setting.type) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "is not a number";
      if (value < setting.min) return `is below the minimum ${setting.min}`;
      if (value > setting.max) return `is above the maximum ${setting.max}`;
      const step = setting.step ?? 1;
      const steps = (value - setting.min) / step;
      return Math.abs(steps - Math.round(steps)) > 1e-9 ? `is not a step of ${step} from ${setting.min}` : undefined;
    }
    case "boolean":
      return typeof value === "boolean" ? undefined : "is neither on nor off";
    case "choice":
      return typeof value === "string" && setting.options.some((option) => option.value === value) ? undefined : "is not one of the options";
    case "text":
      if (typeof value !== "string") return "is not text";
      if (/[\r\n]/.test(value)) return "has more than one line";
      return value.length > SETTING_TEXT_LIMIT ? `is longer than ${SETTING_TEXT_LIMIT} characters` : undefined;
  }
}

const declarationProblem = (setting: StartWidgetSetting): string | undefined => {
  if (isBlank(setting.label)) return "without a label";
  if (setting.description !== undefined && isBlank(setting.description)) return "with an empty description";
  switch (setting.type) {
    case "number":
      if (!Number.isFinite(setting.min) || !Number.isFinite(setting.max) || setting.min > setting.max) {
        return `from ${setting.min} to ${setting.max}; min and max are numbers and min is not above max`;
      }
      if (setting.step !== undefined && !(Number.isFinite(setting.step) && setting.step > 0)) return `with the step ${setting.step}; a step is a number above 0`;
      break;
    case "choice": {
      const values = setting.options.map((option) => option.value);
      if (values.length === 0) return "without options";
      if (values.some((value) => isBlank(value)) || new Set(values).size !== values.length) return "whose options need distinct values that are not empty";
      if (setting.options.some((option) => isBlank(option.label))) return "with an option without a label";
      break;
    }
    case "boolean":
    case "text":
      break;
    default:
      return `of the type ${JSON.stringify((setting as { readonly type: unknown }).type)}; the types are number, boolean, choice, and text`;
  }
  const problem = settingValueProblem(setting, setting.default);
  return problem === undefined ? undefined : `whose default ${JSON.stringify(setting.default)} ${problem}`;
};

/** Why a widget's settings are not ones Start can offer, completing a sentence that names the widget, or undefined when they are. */
export function settingsProblem(settings: StartWidgetSettings): string | undefined {
  const entries = Object.entries(settings);
  if (entries.length === 0) return "declares settings without any setting";
  for (const [key, setting] of entries) {
    if (!SETTING_KEY.test(key)) return `has the setting key ${JSON.stringify(key)}; a key is letters and digits and starts with a letter`;
    const problem = declarationProblem(setting);
    if (problem !== undefined) return `has the setting ${key} ${problem}`;
  }
  return undefined;
}

const resolve = (settings: StartWidgetSettings, stored: StoredWidgetSettings): ResolvedWidgetSettings => {
  const checked = Object.entries(settings).map(([key, setting]) => {
    const value = stored[key];
    if (value === undefined) return { key, value: setting.default };
    const problem = settingValueProblem(setting, value);
    return problem === undefined ? { key, value }
      : { key, value: setting.default, problem: `${setting.label}: the saved value ${JSON.stringify(value)} ${problem}, so the default ${JSON.stringify(setting.default)} applies.` };
  });
  return {
    values: Object.fromEntries(checked.map(({ key, value }) => [key, value])) as StartWidgetSettingValues,
    problems: checked.flatMap((entry) => entry.problem === undefined ? [] : [entry.problem]),
  };
};

// The same declaration and stored values give the same object, so a widget's effects do not run again on every render of Start.
const resolved = new WeakMap<StartWidgetSettings, WeakMap<StoredWidgetSettings, ResolvedWidgetSettings>>();

/** The values a widget renders with: each stored value its setting accepts, otherwise the default; a rejected stored value is reported, and stored keys the widget does not declare are ignored. */
export function widgetSettingsOf(settings: StartWidgetSettings, stored: StoredWidgetSettings | undefined): ResolvedWidgetSettings {
  const saved = stored ?? NOTHING_STORED;
  const byStored = resolved.get(settings) ?? new WeakMap<StoredWidgetSettings, ResolvedWidgetSettings>();
  const known = byStored.get(saved);
  if (known !== undefined) return known;
  const result = resolve(settings, saved);
  byStored.set(saved, result);
  resolved.set(settings, byStored);
  return result;
}

/** What the layout stores for values the viewer applied: those that differ from their defaults, or nothing when none does. */
export function storedSettingsOf(settings: StartWidgetSettings, values: Readonly<Record<string, JsonValue>>): StoredWidgetSettings | undefined {
  const stranger = Object.keys(values).find((key) => settings[key] === undefined);
  if (stranger !== undefined) throw new Error(`The widget has no setting ${stranger}.`);
  const changed = Object.entries(settings).flatMap(([key, setting]): [string, JsonValue][] => {
    const value = values[key];
    if (value === undefined) throw new Error(`The value of the setting ${key} is missing.`);
    const problem = settingValueProblem(setting, value);
    if (problem !== undefined) throw new Error(`The value ${JSON.stringify(value)} of the setting ${key} ${problem}.`);
    return value === setting.default ? [] : [[key, value]];
  });
  return changed.length === 0 ? undefined : Object.fromEntries(changed);
}
