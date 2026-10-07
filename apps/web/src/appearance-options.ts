/** What the appearance offers besides the color scheme; import-free, the VS Code extension bundles it. */

export interface ChoiceOption<Value extends string = string> {
  readonly value: Value;
  readonly label: string;
  readonly description: string;
}

export const paletteOptions = [
  { value: "schichtwerk", label: "Schichtwerk", description: "Violet-tinted layers with drawn outlines." },
  { value: "graphite", label: "Graphite", description: "Neutral grey with one violet accent." },
  { value: "midnight", label: "Midnight", description: "Deep blue-black with a sky accent." },
  { value: "black", label: "Black", description: "True black with a cyan accent." },
] as const;

export const codeStyleOptions = [
  { value: "tint", label: "Tint", description: "Inline code sits on a tinted background." },
  { value: "outlined", label: "Outlined", description: "Inline code is drawn as a chip with an outline." },
] as const;

export const cornerOptions = [
  { value: "round", label: "Round", description: "Generous corner radius on controls and panels." },
  { value: "tight", label: "Tight", description: "Smaller corner radius on controls and panels." },
] as const;

export const densityOptions = [
  { value: "comfortable", label: "Comfortable", description: "Table rows with the standard padding." },
  { value: "spacious", label: "Spacious", description: "Table rows with more padding." },
] as const;

/** Per choice: the browser storage key, the attribute on the document element, and the VS Code setting. */
export const appearanceChoices = {
  palette: { storageKey: "ragents.palette", attribute: "palette", setting: "palette", label: "Palette", options: paletteOptions, fallback: "schichtwerk" },
  codeStyle: { storageKey: "ragents.codeStyle", attribute: "code-style", setting: "codeStyle", label: "Inline code", options: codeStyleOptions, fallback: "tint" },
  corners: { storageKey: "ragents.corners", attribute: "corners", setting: "corners", label: "Corners", options: cornerOptions, fallback: "round" },
  density: { storageKey: "ragents.density", attribute: "density", setting: "density", label: "Table spacing", options: densityOptions, fallback: "comfortable" },
} as const;

export type AppearanceChoiceId = keyof typeof appearanceChoices;
export type AppearanceValue<Id extends AppearanceChoiceId> = (typeof appearanceChoices)[Id]["options"][number]["value"];
export type AppearanceValues = { readonly [Id in AppearanceChoiceId]: AppearanceValue<Id> };

export const appearanceChoiceIds = Object.keys(appearanceChoices) as readonly AppearanceChoiceId[];

export const defaultAppearance: AppearanceValues = {
  palette: appearanceChoices.palette.fallback,
  codeStyle: appearanceChoices.codeStyle.fallback,
  corners: appearanceChoices.corners.fallback,
  density: appearanceChoices.density.fallback,
};

export type PaletteId = AppearanceValue<"palette">;

export const defaultPalette: PaletteId = defaultAppearance.palette;

export const isAppearanceValue = <Id extends AppearanceChoiceId>(id: Id, value: unknown): value is AppearanceValue<Id> =>
  appearanceChoices[id].options.some((option) => option.value === value);

export const allowedAppearanceValues = (id: AppearanceChoiceId): string =>
  appearanceChoices[id].options.map((option) => option.value).join(", ");
