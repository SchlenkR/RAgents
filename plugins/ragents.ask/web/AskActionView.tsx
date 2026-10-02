import { useAccess } from "@ragents/web/AccessContext";
import { Alert, AlertDescription } from "@ragents/web/ui";
import { useState } from "react";
import type { ActionViewContext } from "@ragents/web/PluginRegistry";
import {
  askPayloadOf,
  askTitleOf,
  DISMISSED_ANSWER,
  isWithdrawn,
  storedAnswersOf,
  SUPERSEDED_ANSWER,
  supersedingInputOf,
  WITHDRAWN_ANSWER,
  type AskQuestion,
  type QuestionAnswer,
} from "../ask-payload";
import { answerQuestions } from "./api";
import { QuestionCard, type QuestionRecord } from "./QuestionCard";

const messageOf = (caught: unknown): string => caught instanceof Error ? caught.message : String(caught);

const closedTextOf = (result: unknown): string =>
  supersedingInputOf(result) !== undefined ? SUPERSEDED_ANSWER
  : isWithdrawn(result) ? WITHDRAWN_ANSWER
  : DISMISSED_ANSWER;

/** The chat puts the asker in front of the title; the card shows it on its own line. */
const askerOf = (text: string, title: string): string | undefined =>
  text === title ? undefined : text.endsWith(`: ${title}`) ? text.slice(0, -(title.length + 2)) : text;

type Shown = { readonly questions: readonly AskQuestion[]; readonly record?: QuestionRecord } | { readonly problem: string };

const shownOf = (action: ActionViewContext["action"]): Shown => {
  try {
    const { questions } = askPayloadOf(action.payload);
    if (action.status === undefined) return { questions };
    return {
      questions,
      record: action.status === "approved" ? { answers: storedAnswersOf(questions, action.result) } : { closed: closedTextOf(action.result) },
    };
  } catch (caught) {
    return { problem: messageOf(caught) };
  }
};

export function AskActionView({ action, session, text }: ActionViewContext) {
  const access = useAccess();
  const [error, setError] = useState<string>();
  const shown = shownOf(action);
  if ("problem" in shown) {
    return <Alert variant="destructive"><AlertDescription>{shown.problem}</AlertDescription></Alert>;
  }

  const answer = (answers: readonly QuestionAnswer[]) => {
    setError(undefined);
    answerQuestions(session.session.id, action.actionId, answers)
      .catch((caught: unknown) => setError(messageOf(caught)));
  };

  return (
    <>
      <QuestionCard
        asker={askerOf(text, askTitleOf(shown.questions))}
        onAnswer={access.can("runs.write") ? answer : undefined}
        questions={shown.questions}
        record={shown.record}
      />
      {error && <p className="text-[0.7rem] text-destructive" role="alert">{error}</p>}
    </>
  );
}
