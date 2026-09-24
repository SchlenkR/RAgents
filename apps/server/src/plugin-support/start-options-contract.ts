export const systemPromptStartOptionId = "ragents.system-prompt";

export const modelStartOptionId = "ragents.model";

export interface StartOptionState {
  id: string;
  owner: string;
  value: unknown;
  presentation: unknown;
  selectable: boolean;
  locked: boolean;
  /** Ob jemand den Wert vor dem Start gewählt hat; eine Vorlage, die etwas anderes festlegt, lehnt den Start dann ab. */
  chosen: boolean;
}

export interface ChoicePresentationOption {
  value: string;
  label: string;
  hint?: string;
}

export interface ChoicePresentation {
  kind: "choice";
  label: string;
  options: readonly ChoicePresentationOption[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isChoiceOption = (value: unknown): value is ChoicePresentationOption =>
  isRecord(value)
  && typeof value.value === "string" && value.value.length > 0
  && typeof value.label === "string" && value.label.length > 0
  && (value.hint === undefined || typeof value.hint === "string");

export const choicePresentationFrom = (presentation: unknown, optionId: string): ChoicePresentation | undefined => {
  if (!isRecord(presentation)) throw new Error(`Die Startoption ${optionId} liefert keine Darstellung`);
  if (presentation.kind !== "choice") return undefined;
  if (typeof presentation.label !== "string" || !presentation.label) {
    throw new Error(`Die Auswahl-Darstellung der Startoption ${optionId} hat kein label`);
  }
  if (!Array.isArray(presentation.options) || !presentation.options.every(isChoiceOption)) {
    throw new Error(`Die Auswahl-Darstellung der Startoption ${optionId} braucht options aus value und label`);
  }
  return { kind: "choice", label: presentation.label, options: presentation.options };
};

export const startOptionStateFrom = (value: unknown): StartOptionState => {
  if (!isRecord(value)
    || typeof value.id !== "string" || !value.id
    || typeof value.owner !== "string" || !value.owner
    || !("value" in value)
    || !("presentation" in value)
    || typeof value.selectable !== "boolean"
    || typeof value.locked !== "boolean"
    || typeof value.chosen !== "boolean") {
    throw new Error("Die Startoption entspricht nicht dem erwarteten Format");
  }
  return {
    id: value.id,
    owner: value.owner,
    value: value.value,
    presentation: value.presentation,
    selectable: value.selectable,
    locked: value.locked,
    chosen: value.chosen,
  };
};
