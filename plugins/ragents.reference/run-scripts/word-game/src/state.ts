export const participants = [
  { handle: "red", name: "Red" },
  { handle: "yellow", name: "Yellow" },
  { handle: "blue", name: "Blue" },
  { handle: "green", name: "Green" },
] as const;

export const targetCount = 12;
export const initialWord = "sun";

export type WordGameState = {
  status?: "setup" | "ready" | "running" | "completed" | "error";
  participants?: { id: string; handle: string; name: string }[];
  entries?: { participant: number; word: string }[];
  pendingInputId?: string;
  subscriptionId?: string;
  error?: string;
  document?: string;
};

export const documentFrom = (entries: NonNullable<WordGameState["entries"]>): string =>
  `# Word game\n\nStarting word: ${initialWord}\n\n${entries.map((entry, index) => `${index + 1}. ${participants[entry.participant]!.name}: ${entry.word}`).join("\n")}\n`;
