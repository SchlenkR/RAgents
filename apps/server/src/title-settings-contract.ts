export interface TitleModelSelection {
  provider: string;
  model: string;
}

export interface TitleModelSettings {
  selection: TitleModelSelection | null;
  models: { provider: string; id: string; label: string }[];
}
