/** The vocabulary of all pages: exactly one word per state, which appears in the panel only as a title. */
export type RunStateName = "running" | "waiting" | "idle" | "ended" | "failed" | "cancelled";

export type ConnectionStateName =
  | "connected" | "ready" | "starting" | "login-required" | "unreachable" | "stopped" | "failed" | "forbidden";

const RUN_WORDS: Record<RunStateName, string> = {
  running: "running",
  waiting: "waiting for input",
  idle: "idle",
  ended: "ended",
  failed: "failed",
  cancelled: "cancelled",
};

const CONNECTION_WORDS: Record<ConnectionStateName, string> = {
  connected: "connected",
  ready: "ready",
  starting: "starting",
  "login-required": "sign-in required",
  unreachable: "unreachable",
  stopped: "stopped",
  failed: "failed",
  forbidden: "no access",
};

/** When a run is waiting, the word names the number of open inputs; a tool name never appears in the state. */
export const runStateWord = (state: RunStateName, open = 0): string =>
  state === "waiting" && open > 0 ? `${RUN_WORDS.waiting} (${open})` : RUN_WORDS[state];

export const connectionStateWord = (state: ConnectionStateName): string => CONNECTION_WORDS[state];
