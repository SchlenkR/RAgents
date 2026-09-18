export interface ChatTexts {
  working: string;
  toolRunning: string;
  toolStillRunning: string;
  currentTool: string;
  thinkingChip: string;
  toolChip: string;
  stepGroupOne: string;
  stepGroupMany: string;
  thinkingTitle: string;
  toolTitle: string;
  argumentsLabel: string;
  resultLabel: string;
  close: string;
  jumpToEnd: string;
  send: string;
  sendIntoRun: string;
  stop: string;
  placeholder: string;
  steeringPlaceholder: string;
  inputHint: string;
  detailModeTitle: string;
  detailModeOff: string;
  detailModeCurrent: string;
  detailModeIcons: string;
  detailModeChips: string;
  detailModeGrouped: string;
  detailModeCompact: string;
  detailModeFull: string;
}

export const defaultTexts: ChatTexts = {
  working: "Arbeitet ...",
  toolRunning: "läuft ...",
  toolStillRunning: "Werkzeug läuft ...",
  currentTool: "Werkzeug läuft",
  thinkingChip: "Denken",
  toolChip: "Werkzeug",
  stepGroupOne: "1 Schritt",
  stepGroupMany: "{count} Schritte",
  thinkingTitle: "Thinking-Trace",
  toolTitle: "Tool-Call",
  argumentsLabel: "Argumente",
  resultLabel: "Ergebnis",
  close: "Schließen",
  jumpToEnd: "Zum Ende springen",
  send: "Senden",
  sendIntoRun: "In den laufenden Lauf schicken",
  stop: "Arbeit stoppen",
  placeholder: "Nachricht schreiben ...",
  steeringPlaceholder: "Dazwischenfunken ...",
  inputHint: "Enter zum Senden - Shift + Enter für eine neue Zeile",
  detailModeTitle: "Detailgrad der Schritte",
  detailModeOff: "nur Antworten",
  detailModeCurrent: "aktuell",
  detailModeIcons: "Symbole",
  detailModeChips: "kompakt",
  detailModeGrouped: "gruppiert",
  detailModeCompact: "einzeilig",
  detailModeFull: "alles",
};
