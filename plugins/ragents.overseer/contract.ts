export const OVERSEER_PLUGIN_ID = "ragents.overseer";
export const OVERSEER_RUN_ID = "overseer";
export const QUICK_ANSWER_MAX_LENGTH = 240;

export interface QuickAnswerState {
  kind: "quick-answer";
  question: string;
  text: string;
}

export const overseerPermissions = [
  { id: "ragents.overseer.read", description: "Den übergeordneten Koordinator und seine Modellauswahl ansehen." },
  { id: "ragents.overseer.write", description: "Dem übergeordneten Koordinator Aufträge geben und sein Gespräch zurücksetzen." },
] as const;

export interface OverseerModelSelection {
  provider: string;
  model: string;
  thinking: string;
}

export interface OverseerSettings extends OverseerModelSelection {
  models: Array<{ id: string; provider: string; label: string; thinking: string[] }>;
}
