export type PaletteMode = "light" | "dark";

interface Ladder {
  readonly app: number;
  readonly shell: number;
  readonly background: number;
  readonly card: number;
  readonly secondary: number;
  readonly popover: number;
  readonly foreground: number;
  readonly muted: number;
  readonly borderSoft: number;
  readonly border: number;
  readonly borderStrong: number;
  readonly primary: number;
  readonly primaryHover: number;
  readonly ring: number;
  readonly accentSoft: number;
  readonly selected: number;
  readonly selectedFg: number;
  readonly selectedBorder: number;
}

interface Hue {
  readonly hue: number;
  readonly chroma: number;
}

export interface PaletteSeed {
  readonly label: string;
  readonly neutral: Hue;
  readonly accent: Hue;
  readonly codeHue: number;
  readonly activeHue?: number;
  readonly flatBackdrop?: true;
  readonly light: Ladder;
  readonly dark: Ladder;
}

export type Tokens = Readonly<Record<string, string>>;

export interface ContrastRule {
  readonly pair: string;
  readonly ratio: number;
  readonly goal: number;
  readonly pass: boolean;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const encode = (value: number) => value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
const decode = (value: number) => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);

type Rgb = readonly [number, number, number];

const toLinear = (lightness: number, chroma: number, hue: number): Rgb => {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
};

const inGamut = (rgb: Rgb) => rgb.every((value) => value >= -0.0005 && value <= 1.0005);

/** OKLCH to sRGB; lowers the chroma until the color fits the gamut. */
const rgbOf = (lightness: number, chroma: number, hue: number): Rgb => {
  let reduced = chroma;
  let linear = toLinear(lightness, reduced, hue);
  while (!inGamut(linear) && reduced > 0) {
    reduced = Math.max(0, reduced - 0.002);
    linear = toLinear(lightness, reduced, hue);
  }
  return [encode(clamp01(linear[0])), encode(clamp01(linear[1])), encode(clamp01(linear[2]))];
};

const byte = (value: number) => Math.round(clamp01(value) * 255).toString(16).padStart(2, "0");

const hex = (rgb: Rgb, alpha?: number) => `#${rgb.map(byte).join("")}${alpha === undefined ? "" : byte(alpha)}`;

const ok = (lightness: number, chroma: number, hue: number, alpha?: number) => hex(rgbOf(lightness, chroma, hue), alpha);

const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map(decode) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const parse = (value: string): Rgb => [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16) / 255) as unknown as Rgb;

export const contrast = (first: string, second: string) => {
  const [high, low] = [luminance(parse(first)), luminance(parse(second))].sort((left, right) => right - left) as [number, number];
  return (high + 0.05) / (low + 0.05);
};

const percentByte = (value: number) => Math.round(value * 255).toString(16).padStart(2, "0");

/** Moves a lightness in steps until make(lightness) differs from every surface by its ratio; the seed is only the starting point. */
const fitLightness = (start: number, step: number, make: (lightness: number) => string, targets: readonly (readonly [string, number])[]): number => {
  let lightness = start;
  for (let guard = 0; guard < 160; guard++) {
    const color = make(lightness);
    if (targets.every(([surface, ratio]) => contrast(color, surface) >= ratio)) return lightness;
    lightness += step;
    if (lightness < 0 || lightness > 1) break;
  }
  throw new Error(`No lightness from ${start} fits the surfaces ${targets.map(([surface, ratio]) => `${surface}:${ratio}`).join(", ")}`);
};

const fit = (start: number, step: number, make: (lightness: number) => string, targets: readonly (readonly [string, number])[]): string =>
  make(fitLightness(start, step, make, targets));

const modeTokens = (mode: PaletteMode, seed: PaletteSeed): Tokens => {
  const dark = mode === "dark";
  const neutralHue = seed.neutral.hue;
  const neutralChroma = seed.neutral.chroma;
  const accentHue = seed.accent.hue;
  const accentChroma = seed.accent.chroma;
  const neutral = (lightness: number, factor = 1) => ok(lightness, neutralChroma * factor, neutralHue);
  const accent = (lightness: number, factor = 1) => ok(lightness, accentChroma * factor, accentHue);
  const ladder = dark ? seed.dark : seed.light;
  const tokens: Record<string, string> = {};

  tokens.app = neutral(ladder.app, 0.9);
  tokens.shell = neutral(ladder.shell, 0.95);
  tokens.background = neutral(ladder.background);
  tokens.card = neutral(ladder.card);
  tokens.secondary = neutral(ladder.secondary, 1.1);
  tokens.popover = neutral(ladder.popover, 0.9);
  tokens.foreground = neutral(ladder.foreground, 0.5);
  tokens["muted-foreground"] = neutral(ladder.muted, 0.7);
  const content = [tokens.background, tokens.card, tokens.popover];
  const everywhere = [tokens.app, tokens.shell, tokens.background, tokens.card, tokens.secondary, tokens.popover];
  const away = dark ? 0.005 : -0.005;
  const separate = (start: number, factor: number, ratio: number, surfaces: readonly string[], extra: readonly (readonly [string, number])[] = []) =>
    fit(start, away, (lightness) => neutral(lightness, factor), [...surfaces.map((surface) => [surface, ratio] as const), ...extra]);
  tokens["border-soft"] = separate(ladder.borderSoft, 1.1, dark ? 1.22 : 1.2, content);
  tokens.border = separate(ladder.border, 1.2, dark ? 1.4 : 1.35, everywhere, [[tokens.card!, dark ? 1.55 : 1.45]]);
  tokens["border-strong"] = separate(ladder.borderStrong, 1.3, 3, content, [[tokens.secondary!, 2.6]]);
  tokens.band = fit(dark ? ladder.card + 0.05 : ladder.card - 0.05, away, (lightness) => neutral(lightness, 1.15), [[tokens.card!, dark ? 1.22 : 1.2], [tokens.background!, 1.1]]);

  const selectedLightness = fitLightness(ladder.selected, away, (lightness) => accent(lightness, 0.34), [...content.map((surface) => [surface, 1.2] as const), [tokens.card!, dark ? 1.35 : 1.32]]);
  tokens.selected = accent(selectedLightness, 0.34);
  tokens["selected-hover"] = accent(selectedLightness + (dark ? 0.03 : -0.02), 0.36);
  tokens["selected-icon"] = accent(selectedLightness + (dark ? -0.04 : 0.02), 0.3);
  tokens["selected-icon-hover"] = accent(selectedLightness + (dark ? -0.01 : 0), 0.33);
  tokens["selected-foreground"] = accent(ladder.selectedFg, 0.35);
  tokens["selected-border"] = fit(ladder.selectedBorder, away, (lightness) => accent(lightness, 0.8), [[tokens.selected!, 3], [tokens.card!, 3]]);
  tokens["hover-foreground"] = tokens.foreground;

  const textOn = [tokens.background!, tokens.card!, tokens.selected!, tokens["selected-hover"]!];
  const textFit = (start: number, make: (lightness: number) => string, extra: readonly string[] = []) =>
    fitLightness(start, away, make, [...textOn, ...extra].map((surface) => [surface, 4.5] as const));
  const primaryLightness = textFit(ladder.primary, (lightness) => accent(lightness));
  tokens.primary = accent(primaryLightness);
  tokens["primary-hover"] = accent(primaryLightness + ladder.primaryHover - ladder.primary);
  tokens["primary-foreground"] = dark ? neutral(0.17, 0.6) : "#ffffff";
  tokens.ring = accent(ladder.ring);
  const activeHue = seed.activeHue ?? accentHue;
  tokens["active-soft"] = ok(ladder.accentSoft, accentChroma * 0.4, activeHue);
  tokens.active = ok(textFit(ladder.primary, (lightness) => ok(lightness, accentChroma, activeHue), [tokens["active-soft"]]), accentChroma, activeHue);

  const semantic = (name: string, hue: number, chroma: number) => {
    tokens[`${name}-soft`] = ok(dark ? ladder.card + 0.045 : 0.945, chroma * (dark ? 0.42 : 0.25), hue);
    tokens[name] = ok(textFit(dark ? 0.79 : 0.47, (lightness) => ok(lightness, chroma, hue), [tokens[`${name}-soft`]!]), chroma, hue);
  };
  semantic("success", 155, 0.12);
  semantic("warning", 72, 0.12);
  semantic("destructive", 17, 0.15);
  semantic("info", 245, 0.1);
  tokens["destructive-hover"] = ok(dark ? ladder.card + 0.075 : 0.915, dark ? 0.07 : 0.05, 17);
  tokens.teal = ok(dark ? 0.8 : 0.48, 0.09, 195);

  tokens.code = separate(dark ? ladder.secondary + 0.025 : ladder.secondary - 0.01, dark ? 1.3 : 1.2, dark ? 1.35 : 1.18, content);
  tokens["code-border"] = separate(dark ? ladder.border : ladder.border + 0.02, 1.2, dark ? 2 : 1.7, content, [[tokens.code!, 1.3]]);
  tokens["code-foreground"] = ok(dark ? 0.84 : 0.4, 0.07, seed.codeHue);
  tokens["code-tint"] = fit(dark ? ladder.background + 0.09 : ladder.background - 0.08, away, (lightness) => ok(lightness, dark ? 0.05 : 0.045, seed.codeHue), [...content.map((surface) => [surface, dark ? 1.3 : 1.18] as const), [tokens["code-foreground"]!, 4.5]]);

  const fill = (hue: number, chromaDark: number, chromaLight: number, startDark: number, startLight: number, ratio: number) =>
    fit(dark ? startDark : startLight, away, (lightness) => ok(lightness, dark ? chromaDark : chromaLight, hue), content.map((surface) => [surface, ratio] as const));
  tokens["diff-insert"] = fill(150, 0.085, 0.05, ladder.background + 0.08, 0.95, dark ? 1.35 : 1.18);
  tokens["diff-delete"] = fill(17, 0.1, 0.06, ladder.background + 0.08, 0.95, dark ? 1.35 : 1.18);
  const mark = (fillToken: string, hue: number, chromaDark: number, chromaLight: number) =>
    fit(dark ? ladder.background + 0.17 : 0.87, away, (lightness) => ok(lightness, dark ? chromaDark : chromaLight, hue), [[tokens[fillToken]!, 1.32]]);
  tokens["diff-insert-edit"] = mark("diff-insert", 150, 0.12, 0.09);
  tokens["diff-delete-edit"] = mark("diff-delete", 17, 0.14, 0.1);
  const gutter = (fillToken: string, hue: number, chromaDark: number, chromaLight: number) =>
    fit(dark ? ladder.background + 0.12 : 0.91, away, (lightness) => ok(lightness, dark ? chromaDark : chromaLight, hue), [[tokens[fillToken]!, 1.14]]);
  tokens["diff-insert-gutter"] = gutter("diff-insert", 150, 0.1, 0.07);
  tokens["diff-delete-gutter"] = gutter("diff-delete", 17, 0.12, 0.08);

  const onCode = [tokens.code!, tokens["diff-insert"]!, tokens["diff-delete"]!, tokens["diff-insert-edit"]!, tokens["diff-delete-edit"]!];
  const syntax = (name: string, hue: number, chroma: number) => {
    tokens[`syn-${name}`] = fit(dark ? 0.82 : 0.45, dark ? 0.005 : -0.005, (lightness) => ok(lightness, chroma, hue), onCode.map((surface) => [surface, 4.5] as const));
  };
  syntax("keyword", 305, 0.13);
  syntax("string", 150, 0.12);
  syntax("number", 62, 0.13);
  syntax("function", 245, 0.11);
  syntax("type", 195, 0.09);
  syntax("attribute", 20, 0.12);
  tokens["syn-comment"] = fit(dark ? 0.67 : 0.55, dark ? 0.005 : -0.005, (lightness) => neutral(lightness, 0.8), onCode.map((surface, index) => [surface, index < 3 ? 4.5 : 3.2] as const));

  tokens["env-lightness"] = dark ? "0.79" : "0.55";
  tokens["env-chroma"] = dark ? "0.1" : "0.12";

  tokens["glass-agent"] = ok(dark ? 0.34 : 0.88, dark ? 0.04 : 0.05, 45);
  tokens["glass-primary"] = ok(dark ? 0.33 : 0.88, dark ? 0.05 : 0.04, accentHue);
  tokens["glass-script"] = ok(dark ? 0.34 : 0.9, dark ? 0.05 : 0.08, 95);
  tokens["glass-app"] = ok(dark ? 0.31 : 0.92, dark ? 0.03 : 0.025, 235);
  tokens["glass-edge"] = ok(dark ? 0.6 : 0.62, 0.03, neutralHue);
  tokens["glass-icon"] = ok(dark ? 0.33 : 0.91, 0.03, accentHue);
  tokens["glass-head"] = ok(dark ? 0.29 : 0.93, 0.025, accentHue);
  tokens["glass-group"] = `${ok(dark ? 0.75 : 0.92, 0.04, accentHue)}${dark ? "08" : "40"}`;

  const shadowBase = dark ? "#000000" : ok(0.3, 0.04, neutralHue);
  const shadow = (strength: number) => `${shadowBase.slice(0, 7)}${percentByte(Math.min(1, strength * (dark ? 1.9 : 1)))}`;
  tokens["bar-shadow"] = `0 2px 5px ${shadow(0.08)}, 0 8px 20px ${shadow(0.07)}`;
  tokens["status-shadow"] = `0 -2px 5px ${shadow(0.08)}, 0 -8px 20px ${shadow(0.07)}`;
  tokens["pop-shadow"] = `0 12px 36px ${shadow(dark ? 0.2 : 0.16)}`;
  tokens["card-shadow"] = `0 12px 22px ${shadow(dark ? 0.22 : 0.18)}`;
  tokens["workspace-shadow"] = `-2px 0 5px ${shadow(0.08)}, -8px 0 20px ${shadow(0.11)}`;
  tokens["glass-icon-shadow"] = `1px 2px 4px ${shadow(dark ? 0.2 : 0.14)}`;
  tokens.backdrop = dark ? "#000000a6" : "#00000066";

  const glow = (hue: number, lightness: number, chroma: number, opacity: number, at: string, size: string) =>
    `radial-gradient(ellipse at ${at}, ${ok(lightness, chroma, hue)}${percentByte(opacity)}, transparent ${size})`;
  if (seed.flatBackdrop) {
    tokens["surface-backdrop"] = `linear-gradient(135deg, ${tokens.app}, ${tokens.app})`;
  } else if (dark) {
    tokens["surface-backdrop"] = [
      glow(accentHue, 0.38, 0.05, 0.18, "48% 38%", "48%"), glow(175, 0.42, 0.06, 0.55, "4% 88%", "58%"), glow(240, 0.44, 0.07, 0.55, "96% 12%", "56%"),
      glow(accentHue, 0.4, 0.07, 0.5, "28% 0%", "58%"), glow(50, 0.38, 0.04, 0.2, "88% 100%", "52%"), `linear-gradient(135deg, ${neutral(ladder.app + 0.02)}, ${neutral(ladder.app + 0.04, 1.4)})`,
    ].join(",\n        ");
  } else {
    tokens["surface-backdrop"] = [
      glow(neutralHue, 1, 0, 0.5, "48% 38%", "48%"), glow(175, 0.85, 0.07, 0.7, "4% 88%", "58%"), glow(240, 0.85, 0.07, 0.7, "96% 12%", "56%"),
      glow(accentHue, 0.82, 0.07, 0.7, "28% 0%", "58%"), glow(50, 0.9, 0.05, 0.65, "88% 100%", "52%"), `linear-gradient(135deg, ${neutral(0.96)}, ${neutral(0.92, 1.4)})`,
    ].join(",\n        ");
  }
  tokens.surface = neutral(dark ? ladder.app + 0.01 : 0.93, 1.2);
  tokens["surface-dot"] = `${ok(0.7, 0.05, 210)}${dark ? "30" : "3b"}`;
  tokens["surface-glow-mint"] = `${ok(dark ? 0.5 : 0.82, 0.08, 170)}${dark ? "6b" : "ad"}`;
  tokens["surface-glow-blue"] = `${ok(dark ? 0.52 : 0.8, 0.09, 240)}${dark ? "80" : "a6"}`;
  tokens["surface-light"] = dark ? `${ok(0.78, 0.04, 200)}1f` : "#ffffffb3";
  return tokens;
};

export const palettes = {
  schichtwerk: {
    label: "Schichtwerk",
    neutral: { hue: 300, chroma: 0.02 },
    accent: { hue: 305, chroma: 0.11 },
    codeHue: 20,
    dark: { app: 0.205, shell: 0.23, background: 0.255, card: 0.295, secondary: 0.34, popover: 0.32, foreground: 0.95, muted: 0.8, borderSoft: 0.32, border: 0.42, borderStrong: 0.6, primary: 0.78, primaryHover: 0.84, ring: 0.8, accentSoft: 0.33, selected: 0.37, selectedFg: 0.95, selectedBorder: 0.68 },
    light: { app: 0.9, shell: 0.925, background: 0.975, card: 0.95, secondary: 0.925, popover: 0.995, foreground: 0.24, muted: 0.42, borderSoft: 0.905, border: 0.85, borderStrong: 0.63, primary: 0.46, primaryHover: 0.4, ring: 0.5, accentSoft: 0.93, selected: 0.89, selectedFg: 0.3, selectedBorder: 0.55 },
  },
  graphite: {
    label: "Graphite",
    neutral: { hue: 270, chroma: 0.006 },
    accent: { hue: 282, chroma: 0.15 },
    codeHue: 40,
    flatBackdrop: true,
    dark: { app: 0.14, shell: 0.17, background: 0.2, card: 0.245, secondary: 0.292, popover: 0.27, foreground: 0.95, muted: 0.79, borderSoft: 0.28, border: 0.37, borderStrong: 0.56, primary: 0.76, primaryHover: 0.82, ring: 0.78, accentSoft: 0.3, selected: 0.33, selectedFg: 0.95, selectedBorder: 0.66 },
    light: { app: 0.93, shell: 0.95, background: 0.99, card: 0.97, secondary: 0.945, popover: 1, foreground: 0.2, muted: 0.42, borderSoft: 0.925, border: 0.875, borderStrong: 0.645, primary: 0.5, primaryHover: 0.43, ring: 0.52, accentSoft: 0.94, selected: 0.91, selectedFg: 0.3, selectedBorder: 0.58 },
  },
  midnight: {
    label: "Midnight",
    neutral: { hue: 252, chroma: 0.03 },
    accent: { hue: 235, chroma: 0.13 },
    activeHue: 295,
    codeHue: 70,
    dark: { app: 0.13, shell: 0.16, background: 0.19, card: 0.24, secondary: 0.29, popover: 0.265, foreground: 0.95, muted: 0.79, borderSoft: 0.27, border: 0.36, borderStrong: 0.55, primary: 0.77, primaryHover: 0.83, ring: 0.78, accentSoft: 0.29, selected: 0.31, selectedFg: 0.95, selectedBorder: 0.66 },
    light: { app: 0.92, shell: 0.94, background: 0.985, card: 0.965, secondary: 0.94, popover: 1, foreground: 0.21, muted: 0.42, borderSoft: 0.92, border: 0.87, borderStrong: 0.64, primary: 0.5, primaryHover: 0.43, ring: 0.52, accentSoft: 0.94, selected: 0.91, selectedFg: 0.3, selectedBorder: 0.58 },
  },
  black: {
    label: "Black",
    neutral: { hue: 270, chroma: 0.004 },
    accent: { hue: 195, chroma: 0.12 },
    codeHue: 30,
    flatBackdrop: true,
    dark: { app: 0, shell: 0.085, background: 0.12, card: 0.175, secondary: 0.225, popover: 0.2, foreground: 0.97, muted: 0.8, borderSoft: 0.24, border: 0.335, borderStrong: 0.54, primary: 0.82, primaryHover: 0.88, ring: 0.84, accentSoft: 0.26, selected: 0.28, selectedFg: 0.96, selectedBorder: 0.66 },
    light: { app: 0.93, shell: 0.96, background: 1, card: 0.975, secondary: 0.95, popover: 1, foreground: 0.14, muted: 0.4, borderSoft: 0.93, border: 0.88, borderStrong: 0.62, primary: 0.48, primaryHover: 0.4, ring: 0.5, accentSoft: 0.95, selected: 0.92, selectedFg: 0.28, selectedBorder: 0.55 },
  },
} as const satisfies Record<string, PaletteSeed>;

export type PaletteName = keyof typeof palettes;

export const defaultPaletteName: PaletteName = "schichtwerk";

export const paletteTokens = (name: PaletteName, mode: PaletteMode): Tokens => modeTokens(mode, palettes[name]);

/** Readability and separation targets of one mode; text pairs, control boundaries and the steps between surfaces. */
export const contrastRules = (mode: PaletteMode, tokens: Tokens): ContrastRule[] => {
  const dark = mode === "dark";
  const text: readonly (readonly [string, string, number])[] = [
    ["foreground", "background", 7], ["foreground", "card", 7], ["foreground", "secondary", 7],
    ["muted-foreground", "background", 4.5], ["muted-foreground", "card", 4.5], ["muted-foreground", "secondary", 4.5], ["muted-foreground", "popover", 4.5],
    ["primary", "background", 4.5], ["primary-foreground", "primary", 4.5], ["selected-foreground", "selected", 4.5], ["selected-foreground", "selected-hover", 4.5],
    ["selected-border", "selected", 3], ["selected-border", "card", 3],
    ...["primary", "success", "warning", "destructive", "info", "active"].flatMap((name) => ["selected", "selected-hover"].map((surface) => [name, surface, 4.5] as const)),
    ["success", "success-soft", 4.5], ["warning", "warning-soft", 4.5], ["destructive", "destructive-soft", 4.5], ["info", "info-soft", 4.5], ["active", "active-soft", 4.5],
    ["code-foreground", "code", 4.5], ["code-foreground", "code-tint", 4.5], ["foreground", "code", 7], ["border-strong", "background", 3], ["border-strong", "card", 3], ["border-strong", "popover", 3],
    ["syn-keyword", "code", 4.5], ["syn-string", "code", 4.5], ["syn-number", "code", 4.5], ["syn-function", "code", 4.5], ["syn-type", "code", 4.5], ["syn-attribute", "code", 4.5], ["syn-comment", "code", 4.5],
    ["foreground", "diff-insert", 7], ["foreground", "diff-delete", 7], ["foreground", "diff-insert-edit", 4.5], ["foreground", "diff-delete-edit", 4.5],
    ["syn-keyword", "diff-insert", 4.5], ["syn-keyword", "diff-delete", 4.5], ["syn-keyword", "diff-insert-edit", 4.5], ["syn-keyword", "diff-delete-edit", 4.5], ["syn-attribute", "diff-delete-edit", 4.5], ["syn-string", "diff-insert-edit", 4.5],
    ["syn-comment", "diff-insert", 4.5], ["syn-comment", "diff-delete", 4.5], ["syn-comment", "diff-insert-edit", 3.2], ["syn-comment", "diff-delete-edit", 3.2],
  ];
  const content = ["background", "card", "popover"] as const;
  const everywhere = ["app", "shell", "background", "card", "secondary", "popover"] as const;
  const fills = ["diff-insert", "diff-delete"] as const;
  const surfaces: readonly (readonly [string, string, number])[] = [
    ["card", "background", dark ? 1.05 : 1.04],
    ["secondary", "background", dark ? 1.15 : 1.08],
    ...everywhere.map((surface) => ["border", surface, dark ? 1.4 : 1.35] as const),
    ["border", "card", dark ? 1.55 : 1.45],
    ...content.map((surface) => ["border-soft", surface, dark ? 1.22 : 1.2] as const),
    ["band", "card", dark ? 1.22 : 1.2], ["band", "background", 1.1],
    ["selected", "card", dark ? 1.35 : 1.32], ...content.map((surface) => ["selected", surface, 1.2] as const),
    ...content.map((surface) => ["code", surface, dark ? 1.35 : 1.18] as const),
    ...content.map((surface) => ["code-tint", surface, dark ? 1.3 : 1.18] as const),
    ...content.map((surface) => ["code-border", surface, dark ? 2 : 1.7] as const),
    ["code-border", "code", 1.3],
    ...content.flatMap((surface) => fills.map((fill) => [fill, surface, dark ? 1.35 : 1.18] as const)),
    ["diff-insert-edit", "diff-insert", 1.32], ["diff-delete-edit", "diff-delete", 1.32],
    ["diff-insert-gutter", "diff-insert", 1.14], ["diff-delete-gutter", "diff-delete", 1.14],
    ["border-strong", "secondary", 2.6],
  ];
  return [...text, ...surfaces].map(([first, second, goal]) => {
    const ratio = contrast(tokens[first]!, tokens[second]!);
    return { pair: `${first} on ${second}`, ratio, goal, pass: ratio >= goal };
  });
};

const block = (selector: string, tokens: Tokens) => `${selector} {\n${Object.entries(tokens).map(([name, value]) => `    --${name}: ${value};`).join("\n")}\n}`;

/** The complete stylesheet: one light and one dark block per palette; the default palette also answers on the root element. */
export const paletteStylesheet = (): string => {
  const header = "/* Generated from OKLCH seeds, one block per palette and mode; contrast is asserted by the generator. */";
  const blocks = (Object.keys(palettes) as PaletteName[]).flatMap((name) => {
    const isDefault = name === defaultPaletteName;
    return [
      `/* ${palettes[name].label} */`,
      block(isDefault ? `:root,\n[data-palette="${name}"]` : `[data-palette="${name}"]`, paletteTokens(name, "light")),
      block(isDefault ? `:root[data-theme="dark"],\n[data-palette="${name}"][data-theme="dark"]` : `[data-palette="${name}"][data-theme="dark"]`, paletteTokens(name, "dark")),
    ];
  });
  return `${[header, ...blocks].join("\n\n")}\n`;
};
