export const ASK_PLUGIN_ID = "ragents.ask";

export interface AskPayload {
  question: string;
  options: string[];
  multi: boolean;
}

const stringArrayOf = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [...value] : undefined;

export const askPayloadOf = (payload: unknown): AskPayload | undefined => {
  if (typeof payload !== "object" || payload === null) return undefined;
  const candidate = payload as Partial<AskPayload>;
  const options = stringArrayOf(candidate.options);
  if (typeof candidate.question !== "string" || !options) return undefined;
  return { question: candidate.question, options, multi: candidate.multi === true };
};
