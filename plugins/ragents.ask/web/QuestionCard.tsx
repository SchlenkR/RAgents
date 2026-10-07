import { CheckIcon } from "lucide-react";
import { Badge, Button, Card, Input } from "@ragents/web/ui";
import { useState } from "react";
import type { AskQuestion, QuestionAnswer } from "../ask-payload";

/** A closed card: one answer per question, or the text that says why there is none. */
export type QuestionRecord = { readonly answers: readonly QuestionAnswer[] } | { readonly closed: string };

interface Draft {
  readonly selected: readonly string[];
  readonly text: string;
}

const cardClasses = "gap-3 bg-background px-4 text-sm";
const groupClasses = "flex flex-col gap-2";
const optionClasses = "h-auto w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm font-normal whitespace-normal";

const answerOf = (draft: Draft): QuestionAnswer | undefined =>
  draft.text.trim() !== "" ? { text: draft.text.trim() } : draft.selected.length > 0 ? { selected: draft.selected } : undefined;

const answerText = (answer: QuestionAnswer): string => "text" in answer ? answer.text : answer.selected.join(", ");

const toggled = (selected: readonly string[], label: string): readonly string[] =>
  selected.includes(label) ? selected.filter((entry) => entry !== label) : [...selected, label];

function QuestionHead({ question }: { question: AskQuestion }) {
  return (
    <div className="flex items-start gap-2">
      <Badge className="mt-px" variant="secondary">{question.header}</Badge>
      <div className="leading-normal">{question.question}</div>
    </div>
  );
}

function Asker({ asker }: { asker: string | undefined }) {
  return asker ? <div className="text-xs text-muted-foreground">{asker}</div> : null;
}

/** All questions of one call in one card with a free answer per question and one submit; closed, only the record remains. */
export function QuestionCard({
  asker,
  questions,
  record,
  onAnswer,
}: {
  asker?: string;
  questions: readonly AskQuestion[];
  record?: QuestionRecord;
  onAnswer?: (answers: readonly QuestionAnswer[]) => void;
}) {
  const [drafts, setDrafts] = useState<readonly Draft[]>(() => questions.map(() => ({ selected: [], text: "" })));

  if (record) {
    return (
      <Card className={cardClasses} size="sm">
        <Asker asker={asker} />
        {questions.map((question, index) => (
          <div aria-label={question.header} className={groupClasses} key={question.question} role="group">
            <QuestionHead question={question} />
            {"answers" in record && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" data-question="answered">
                <CheckIcon className="flex-none text-success" size={12} />
                {answerText(record.answers[index]!)}
              </div>
            )}
          </div>
        ))}
        {"closed" in record && <div className="text-sm text-muted-foreground" data-question="closed">{record.closed}</div>}
      </Card>
    );
  }

  if (!onAnswer) {
    return (
      <Card className={cardClasses} size="sm">
        <Asker asker={asker} />
        {questions.map((question) => (
          <div aria-label={question.header} className={groupClasses} key={question.question} role="group">
            <QuestionHead question={question} />
            <ul className="list-disc pl-6">
              {question.options.map((option) => (
                <li key={option.label}>
                  {option.label}
                  {option.description && <span className="text-muted-foreground"> - {option.description}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Card>
    );
  }

  const answers = drafts.map(answerOf).filter((answer): answer is QuestionAnswer => answer !== undefined);
  const complete = answers.length === questions.length;
  const submit = () => {
    if (complete) onAnswer(answers);
  };
  const instant = questions.length === 1 && !questions[0]!.multiSelect;
  const update = (index: number, change: (draft: Draft) => Draft) =>
    setDrafts((previous) => previous.map((draft, at) => at === index ? change(draft) : draft));
  const choose = (index: number, question: AskQuestion, label: string) => {
    if (instant) onAnswer([{ selected: [label] }]);
    else update(index, (draft) => ({ text: "", selected: question.multiSelect ? toggled(draft.selected, label) : [label] }));
  };

  return (
    <Card className={cardClasses} size="sm">
      <Asker asker={asker} />
      {questions.map((question, index) => (
        <div aria-label={question.header} className={groupClasses} key={question.question} role="group">
          <QuestionHead question={question} />
          {question.options.map((option) => {
            const selected = drafts[index]!.selected.includes(option.label);
            return (
              <Button
                aria-pressed={selected}
                className={optionClasses}
                data-question="option"
                key={option.label}
                onClick={() => choose(index, question, option.label)}
                variant="outline"
              >
                <span className="flex items-center gap-2 font-medium">
                  {question.multiSelect && (
                    <span className="inline-flex size-3.5 flex-none items-center justify-center rounded-sm border border-border text-primary group-aria-pressed/button:border-primary">
                      {selected && <CheckIcon size={10} />}
                    </span>
                  )}
                  {option.label}
                </span>
                {option.description && <span className="text-xs text-muted-foreground">{option.description}</span>}
              </Button>
            );
          })}
          <Input
            aria-label={`Free answer: ${question.header}`}
            onChange={(event) => update(index, () => ({ selected: [], text: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            placeholder="... or answer freely"
            value={drafts[index]!.text}
          />
        </div>
      ))}
      <Button className="self-start" disabled={!complete} onClick={submit} size="sm">
        {questions.length === 1 ? "Submit answer" : "Submit answers"}
      </Button>
    </Card>
  );
}
