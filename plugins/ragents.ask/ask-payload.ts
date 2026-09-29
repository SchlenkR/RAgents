export const ASK_PLUGIN_ID = "ragents.ask";

/** What the asking tool call gets when a person's message to the asker closes its question. */
export const SUPERSEDED_ANSWER = "Not answered: the user sent a new message instead.";

export interface AskPayload {
  question: string;
  options: string[];
  multi: boolean;
  /** The actor the question stands for when the run owner asks it outside a turn. */
  recipient?: string;
}

const stringArrayOf = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [...value] : undefined;

export const askPayloadOf = (payload: unknown): AskPayload | undefined => {
  if (typeof payload !== "object" || payload === null) return undefined;
  const candidate = payload as Partial<AskPayload>;
  const options = stringArrayOf(candidate.options);
  if (typeof candidate.question !== "string" || !options) return undefined;
  return {
    question: candidate.question,
    options,
    multi: candidate.multi === true,
    ...(typeof candidate.recipient === "string" ? { recipient: candidate.recipient } : {}),
  };
};

export const supersedingInputOf = (result: unknown): string | undefined => {
  if (typeof result !== "object" || result === null) return undefined;
  const { supersededBy } = result as { supersededBy?: unknown };
  return typeof supersededBy === "string" ? supersededBy : undefined;
};
