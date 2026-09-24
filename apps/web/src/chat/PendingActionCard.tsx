import { CheckIcon } from "lucide-react";
import { Button, Card } from "../ui";
import type { PendingAction } from "./types";

const cardClasses = "gap-2.5 bg-background px-3.5 text-sm";

const resultText = (result: unknown): string =>
  typeof result === "string" ? result : result === null || result === undefined ? "" : JSON.stringify(result);

/**
 * Die Darstellung einer wartenden Aktion ohne Beitrag ihres Eigentümers: Titel, der Hinweis,
 * dass eine Eingabe erwartet wird, und das Verwerfen. Die Form kennt nur das Plugin.
 */
export function PendingActionCard({
  text,
  action,
  waitingLabel,
  dismissLabel,
  dismissedLabel,
  onDismiss,
}: {
  text: string;
  action: PendingAction;
  waitingLabel: string;
  dismissLabel: string;
  dismissedLabel: string;
  onDismiss?: () => void;
}) {
  if (action.status !== undefined) {
    return (
      <Card className={cardClasses} size="sm">
        <div className="leading-normal">{text}</div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground" data-action="resolved">
          <CheckIcon className="text-success" size={12} />
          {action.status === "approved" ? resultText(action.result) : dismissedLabel}
        </div>
      </Card>
    );
  }

  return (
    <Card className={cardClasses} size="sm">
      <div className="leading-normal">{text}</div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground" data-action="waiting">{waitingLabel}</span>
        {onDismiss && (
          <Button onClick={onDismiss} size="sm" variant="outline">{dismissLabel}</Button>
        )}
      </div>
    </Card>
  );
}
