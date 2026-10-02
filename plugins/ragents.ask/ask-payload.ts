export const ASK_PLUGIN_ID = "ragents.ask";

/** The record of questions that a person's message to the asker closed; ask_user returns it when such a message already waits. */
export const SUPERSEDED_ANSWER = "Not answered: the user sent a new message instead.";

/** The record of questions the user dismissed. */
export const DISMISSED_ANSWER = "Dismissed by the user without an answer.";

/** The record of questions closed without the user: their asker or run stopped, the run was deleted, or their wait was cancelled. */
export const WITHDRAWN_ANSWER = "Withdrawn without an answer.";

/** The chip of a question shows at most this many characters. */
export const HEADER_MAX_LENGTH = 12;

export interface AskOption {
  readonly label: string;
  readonly description: string;
}

export interface AskQuestion {
  readonly question: string;
  readonly header: string;
  readonly options: readonly AskOption[];
  readonly multiSelect: boolean;
}

export interface AskPayload {
  readonly questions: readonly AskQuestion[];
  /** The actor the questions stand for when the run owner asks them outside a turn. */
  readonly recipient?: string;
}

/** The answer to one question: the labels of the chosen options, or a free answer instead. */
export type QuestionAnswer = { readonly selected: readonly string[] } | { readonly text: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const quoted = (value: unknown): string => JSON.stringify(value) ?? String(value);

const unknownFields = (value: Record<string, unknown>, known: readonly string[], path: string): readonly string[] =>
  Object.keys(value).filter((key) => !known.includes(key)).map((key) => `${path} has unknown field ${key}`);

const textComplaints = (value: unknown, path: string): readonly string[] =>
  typeof value === "string" && value.trim() !== "" ? [] : [`${path} must be a non-empty text, got ${quoted(value)}`];

const duplicatesOf = (values: readonly string[]): readonly string[] =>
  [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];

const optionComplaints = (option: unknown, path: string): readonly string[] => !isRecord(option)
  ? [`${path} must be an object with label and description`]
  : [
    ...unknownFields(option, ["label", "description"], path),
    ...textComplaints(option.label, `${path}.label`),
    ...typeof option.description === "string" ? [] : [`${path}.description must be a text, got ${quoted(option.description)}`],
  ];

const questionComplaints = (question: unknown, path: string): readonly string[] => {
  if (!isRecord(question)) return [`${path} must be an object with question, header, options, and multiSelect`];
  const options = Array.isArray(question.options) ? question.options : [];
  const labels = options.flatMap((option) => isRecord(option) && typeof option.label === "string" ? [option.label] : []);
  return [
    ...unknownFields(question, ["question", "header", "options", "multiSelect"], path),
    ...textComplaints(question.question, `${path}.question`),
    ...textComplaints(question.header, `${path}.header`),
    ...typeof question.header === "string" && question.header.length > HEADER_MAX_LENGTH
      ? [`${path}.header must have at most ${HEADER_MAX_LENGTH} characters, got ${quoted(question.header)}`] : [],
    ...Array.isArray(question.options) && question.options.length >= 2 ? [] : [`${path}.options must list at least 2 options`],
    ...options.flatMap((option, index) => optionComplaints(option, `${path}.options.${index}`)),
    ...duplicatesOf(labels).map((label) => `${path}.options name the label ${quoted(label)} more than once; labels must differ`),
    ...typeof question.multiSelect === "boolean" ? [] : [`${path}.multiSelect must be true or false, got ${quoted(question.multiSelect)}`],
  ];
};

/** Every violated path of a question payload with its reason; empty when the payload is valid. */
export const askPayloadComplaints = (payload: unknown): readonly string[] => {
  if (!isRecord(payload)) return ["the payload must be an object with questions"];
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  const texts = questions.flatMap((question) => isRecord(question) && typeof question.question === "string" ? [question.question] : []);
  return [
    ...unknownFields(payload, ["questions", "recipient"], "payload"),
    ...questions.length > 0 ? [] : ["questions must list at least 1 question"],
    ...questions.flatMap((question, index) => questionComplaints(question, `questions.${index}`)),
    ...duplicatesOf(texts).map((text) => `questions ask ${quoted(text)} more than once; questions must differ`),
    ...payload.recipient === undefined || typeof payload.recipient === "string" ? [] : [`recipient must be a text, got ${quoted(payload.recipient)}`],
  ];
};

export const askPayloadOf = (payload: unknown): AskPayload => {
  const complaints = askPayloadComplaints(payload);
  if (complaints.length > 0) throw new Error(`The questions of ${ASK_PLUGIN_ID} are invalid: ${complaints.join("; ")}`);
  return payload as AskPayload;
};

/** The action title: the questions, one per line. */
export const askTitleOf = (questions: readonly AskQuestion[]): string =>
  questions.map((question) => question.question).join("\n");

const answerComplaintsFor = (question: AskQuestion, answer: unknown, path: string): readonly string[] => {
  if (!isRecord(answer)) return [`${path} must be an object with selected or text`];
  const labels = question.options.map((option) => option.label);
  if (Object.hasOwn(answer, "text")) {
    return [...unknownFields(answer, ["text"], path), ...textComplaints(answer.text, `${path}.text`)];
  }
  if (!Array.isArray(answer.selected)) return [`${path} must have selected (labels of chosen options) or text (a free answer)`];
  const selected = answer.selected as readonly unknown[];
  return [
    ...unknownFields(answer, ["selected"], path),
    ...selected.length === 0 ? [`${path}.selected must name at least 1 option`] : [],
    ...!question.multiSelect && selected.length > 1 ? [`${path}.selected names ${selected.length} options, but the question allows only one`] : [],
    ...selected.flatMap((label, index) => typeof label === "string" && labels.includes(label) ? []
      : [`${path}.selected.${index} is ${quoted(label)}, allowed labels: ${labels.map(quoted).join(", ")}`]),
    ...duplicatesOf(selected.filter((label): label is string => typeof label === "string"))
      .map((label) => `${path}.selected names ${quoted(label)} more than once`),
  ];
};

/** Every violated path of the answers to these questions, one answer per question in their order; empty when they are valid. */
export const answerComplaints = (questions: readonly AskQuestion[], answers: unknown): readonly string[] => {
  if (!Array.isArray(answers)) return ["answers must be a list with one answer per question"];
  return [
    ...answers.length === questions.length ? [] : [`answers has ${answers.length} entries, but there are ${questions.length} questions`],
    ...questions.flatMap((question, index) => index < answers.length ? answerComplaintsFor(question, answers[index], `answers.${index}`) : []),
  ];
};

/** The answers stored as the result of an approved question action. */
export const storedAnswersOf = (questions: readonly AskQuestion[], result: unknown): readonly QuestionAnswer[] => {
  const answers = isRecord(result) ? result.answers : undefined;
  const complaints = [...isRecord(result) ? unknownFields(result, ["answers"], "result") : [], ...answerComplaints(questions, answers)];
  if (complaints.length > 0) throw new Error(`The stored answers of ${ASK_PLUGIN_ID} are invalid: ${complaints.join("; ")}`);
  return answers as readonly QuestionAnswer[];
};

export const supersedingInputOf = (result: unknown): string | undefined => {
  if (typeof result !== "object" || result === null) return undefined;
  const { supersededBy } = result as { supersededBy?: unknown };
  return typeof supersededBy === "string" ? supersededBy : undefined;
};

export const isWithdrawn = (result: unknown): boolean =>
  typeof result === "object" && result !== null && (result as { withdrawn?: unknown }).withdrawn === true;
