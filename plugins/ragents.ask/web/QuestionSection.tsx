import { useAccess } from "@ragents/web/AccessContext";
import { useState } from "react";
import { runActorFrom, runViewFrom } from "@ragents/web/run-view";
import type { CardSectionContext } from "@ragents/web/PluginRegistry";
import { SectionLabel } from "@ragents/web/ui";
import { askPayloadOf, ASK_PLUGIN_ID } from "../ask-payload";
import { answerQuestion } from "./api";
import { QuestionCard } from "./QuestionCard";

export function QuestionSection({ actor, session }: CardSectionContext) {
  const access = useAccess();
  const [error, setError] = useState<string>();
  const view = runViewFrom(session.runView);
  if (!view) return null;
  const actorId = runActorFrom(actor).id;
  const pending = view.actions.filter((action) =>
    action.owner === ASK_PLUGIN_ID && action.askedBy === actorId && action.status === "pending");
  if (pending.length === 0) return null;

  const answer = (actionId: string, text: string) => {
    setError(undefined);
    answerQuestion(session.session.id, actionId, text)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
  };

  return (
    <section className="grid gap-1.5">
      <SectionLabel>
        <span>Rückfrage</span>
        <small>{pending.length}</small>
      </SectionLabel>
      {pending.map((action) => {
        const question = askPayloadOf(action.payload);
        return question && (
          <div className="rounded-lg animate-ring-pulse motion-reduce:animate-none" key={action.id}>
            {action.description && <p className="mb-1.5 text-[0.7rem] leading-[1.35] text-muted-foreground">{action.description}</p>}
            <QuestionCard
              onAnswer={access.can("runs.write") ? (text) => answer(action.id, text) : undefined}
              question={question}
              text={action.title}
            />
          </div>
        );
      })}
      {error && <p className="text-[0.7rem] text-destructive" role="alert">{error}</p>}
    </section>
  );
}
