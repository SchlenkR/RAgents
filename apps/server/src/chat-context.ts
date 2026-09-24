export interface ChatUserLocation {
  page: "home" | "overview" | "run";
  runId: string | null;
  tab: string | null;
  selection: { type: string; id: string } | null;
}
