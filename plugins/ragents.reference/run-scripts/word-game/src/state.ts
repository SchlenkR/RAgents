export const participants = [
  { handle: "red", name: "Rot" },
  { handle: "yellow", name: "Gelb" },
  { handle: "blue", name: "Blau" },
  { handle: "green", name: "Grün" },
] as const;

export const targetCount = 12;
export const initialWord = "Sonne";

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
  `# Wortspiel\n\nAusgangswort: ${initialWord}\n\n${entries.map((entry, index) => `${index + 1}. ${participants[entry.participant]!.name}: ${entry.word}`).join("\n")}\n`;
