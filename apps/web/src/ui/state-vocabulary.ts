/** Das Vokabular aller Seiten: je Zustand genau ein Wort, das im Panel nur als title erscheint. */
export type RunStateName = "running" | "waiting" | "idle" | "ended" | "failed" | "cancelled";

export type EnvironmentStateName =
  | "connected" | "ready" | "starting" | "login-required" | "unreachable" | "stopped" | "failed" | "forbidden";

const RUN_WORDS: Record<RunStateName, string> = {
  running: "läuft",
  waiting: "wartet auf Eingabe",
  idle: "ruht",
  ended: "beendet",
  failed: "fehlgeschlagen",
  cancelled: "abgebrochen",
};

const ENVIRONMENT_WORDS: Record<EnvironmentStateName, string> = {
  connected: "verbunden",
  ready: "bereit",
  starting: "startet",
  "login-required": "Anmeldung nötig",
  unreachable: "nicht erreichbar",
  stopped: "gestoppt",
  failed: "gescheitert",
  forbidden: "kein Zugriff",
};

/** Wartet ein Run, nennt das Wort die Zahl offener Eingaben; ein Werkzeugname steht nie im Zustand. */
export const runStateWord = (state: RunStateName, open = 0): string =>
  state === "waiting" && open > 0 ? `${RUN_WORDS.waiting} (${open})` : RUN_WORDS[state];

export const environmentStateWord = (state: EnvironmentStateName): string => ENVIRONMENT_WORDS[state];
