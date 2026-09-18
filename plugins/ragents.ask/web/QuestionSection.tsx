import { useAccess } from "@aicontainer/web/AccessContext";
import { useState } from "react";
import { QuestionCard } from "@aicontainer/web/chat/QuestionCard";
import { runActorFrom, runViewFrom } from "@aicontainer/plugins/ragents.orchestration/web/contract";
import type { CardSectionContext } from "@aicontainer/web/PluginRegistry";
import { SectionLabel } from "@aicontainer/web/ui";

export function QuestionSection({ actor, session }: CardSectionContext) {
  const access = useAccess();
  const [error, setError] = useState<string>();
  const view = runViewFrom(session.runView);
  if (!view) return null;
  const actorId = runActorFrom(actor).id;
  const pending = view.actions.filter((action) =>
    action.kind === "question" && action.askedBy === actorId && action.status === "pending");
  if (pending.length === 0) return null;

  const answer = (actionId: string, text: string) => {
    setError(undefined);
    session.respond(actionId, text)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
  };

  return (
    <section className="grid gap-1.5">
      <SectionLabel>
        <span>Rückfrage</span>
        <small>{pending.length}</small>
      </SectionLabel>
      {pending.map((action) => (
        <div className="rounded-lg animate-ring-pulse motion-reduce:animate-none" key={action.id}>
          {action.description && <p className="mb-1.5 text-[0.7rem] leading-[1.35] text-muted-foreground">{action.description}</p>}
          <QuestionCard
            onAnswer={access.can("runs.write") ? (text) => answer(action.id, text) : undefined}
            question={{
              callId: action.id,
              options: action.question?.options ?? [],
              multi: action.question?.multi ?? false,
            }}
            text={action.title}
          />
        </div>
      ))}
      {error && <p className="text-[0.7rem] text-destructive" role="alert">{error}</p>}
    </section>
  );
}
