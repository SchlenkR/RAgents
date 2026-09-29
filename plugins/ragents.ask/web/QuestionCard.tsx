import { CheckIcon } from "lucide-react";
import { Button, Card, cn, Input } from "@ragents/web/ui";
import { useState } from "react";
import type { AskPayload } from "../ask-payload";

const cardClasses = "gap-2.5 bg-background px-3.5 text-sm";
const optionClasses = "h-auto w-full justify-start gap-2 px-3 py-1.5 text-left text-sm font-normal whitespace-normal";

/**
 * Question card: options stacked, either single or multiple choice
 * (question.multi), plus always a free answer line. After the answer only the record remains.
 */
export function QuestionCard({
  text,
  question,
  answer,
  onAnswer,
}: {
  text: string;
  question: AskPayload;
  answer?: string;
  onAnswer?: (text: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");

  if (answer !== undefined) {
    return (
      <Card className={cardClasses} size="sm">
        <div className="leading-normal">{text}</div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground" data-question="answered">
          <CheckIcon className="text-success" size={12} />
          {answer}
        </div>
      </Card>
    );
  }

  if (!onAnswer) {
    return (
      <Card className={cardClasses} size="sm">
        <div className="leading-normal">{text}</div>
        <ul className="list-disc pl-6">{question.options.map((option) => <li key={option}>{option}</li>)}</ul>
      </Card>
    );
  }

  const toggle = (option: string) =>
    setSelected((previous) =>
      previous.includes(option) ? previous.filter((o) => o !== option) : [...previous, option]);

  const sendFreeText = () => {
    const value = freeText.trim();
    if (value) onAnswer(value);
  };

  return (
    <Card className={cardClasses} size="sm">
      <div className="leading-normal">{text}</div>
      <div className="flex flex-col items-stretch gap-1.5">
        {question.options.map((option) =>
          question.multi ? (
            <Button
              aria-pressed={selected.includes(option)}
              className={cn(optionClasses, "aria-pressed:border-primary aria-pressed:bg-accent")}
              data-question="option"
              key={option}
              onClick={() => toggle(option)}
              variant="outline"
            >
              <span className="inline-flex size-3.5 flex-none items-center justify-center rounded-sm border border-border text-primary group-aria-pressed/button:border-primary">
                {selected.includes(option) && <CheckIcon size={10} />}
              </span>
              {option}
            </Button>
          ) : (
            <Button className={optionClasses} data-question="option" key={option} onClick={() => onAnswer(option)} variant="outline">
              {option}
            </Button>
          ),
        )}
      </div>
      {question.multi && (
        <Button
          className="self-start"
          disabled={selected.length === 0}
          onClick={() => onAnswer(selected.join("; "))}
          size="sm"
        >
          Apply selection
        </Button>
      )}
      <div className="flex gap-1.5">
        <Input
          className="flex-1"
          onChange={(event) => setFreeText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") sendFreeText();
          }}
          placeholder="... or answer freely"
          value={freeText}
        />
        <Button disabled={freeText.trim() === ""} onClick={sendFreeText} size="sm" variant="outline">
          Answer
        </Button>
      </div>
    </Card>
  );
}
