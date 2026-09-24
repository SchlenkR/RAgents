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
  timestamps: string;
  showTimestamps: string;
  hideTimestamps: string;
  copyMessage: string;
  editMessage: string;
  retryMessage: string;
  copyCode: string;
  copied: string;
  pendingAction: string;
  dismissAction: string;
  actionDismissed: string;
  actionFailed: string;
  clipboardUnavailable: string;
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
  sendIntoRun: "In den laufenden Run schicken",
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
  timestamps: "Zeitstempel",
  showTimestamps: "Zeitstempel anzeigen",
  hideTimestamps: "Zeitstempel ausblenden",
  copyMessage: "Nachricht kopieren",
  editMessage: "Nachricht bearbeiten",
  retryMessage: "Antwort erneut anfordern",
  copyCode: "Code kopieren",
  copied: "Kopiert",
  pendingAction: "wartet auf Eingabe",
  dismissAction: "Verwerfen",
  actionDismissed: "verworfen",
  actionFailed: "Aktion fehlgeschlagen",
  clipboardUnavailable: "Die Zwischenablage ist nicht verfügbar",
};
