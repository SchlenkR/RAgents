export interface ChatUserLocation {
  surface: "home" | "overview" | "run";
  runId: string | null;
  tab: string | null;
  selection: { type: string; id: string } | null;
}
