import { useAccess } from "@ragents/web/AccessContext";
import { useState } from "react";
import type { ActionViewContext } from "@ragents/web/PluginRegistry";
import { askPayloadOf } from "../ask-payload";
import { answerQuestion } from "./api";
import { QuestionCard } from "./QuestionCard";

const answerTextOf = (result: unknown): string =>
  typeof result === "string" ? result : result === null || result === undefined ? "" : JSON.stringify(result);

export function AskActionView({ action, session, text }: ActionViewContext) {
  const access = useAccess();
  const [error, setError] = useState<string>();
  const question = askPayloadOf(action.payload);
  if (!question) return null;

  const answer = (value: string) => {
    setError(undefined);
    answerQuestion(session.session.id, action.actionId, value)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
  };

  return (
    <>
      <QuestionCard
        answer={action.status === undefined
          ? undefined
          : action.status === "approved" ? answerTextOf(action.result) : "Der Benutzer hat die Frage verworfen."}
        onAnswer={access.can("runs.write") ? answer : undefined}
        question={question}
        text={text}
      />
      {error && <p className="text-[0.7rem] text-destructive" role="alert">{error}</p>}
    </>
  );
}
