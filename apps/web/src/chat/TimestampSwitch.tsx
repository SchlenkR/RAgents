import { ClockIcon } from "lucide-react";
import { Button } from "../ui";
import { type ChatTexts, defaultTexts } from "./texts";

export function TimestampSwitch({ showTimestamps, onChange, collapsible = true, texts, className }: {
  showTimestamps: boolean;
  onChange: (showTimestamps: boolean) => void;
  collapsible?: boolean;
  texts?: Partial<ChatTexts>;
  className?: string;
}) {
  const labels = { ...defaultTexts, ...texts };
  const title = showTimestamps ? labels.hideTimestamps : labels.showTimestamps;
  return (
    <Button aria-label={title} aria-pressed={showTimestamps} className={className}
      onClick={() => onChange(!showTimestamps)} size="sm" title={title} variant="ghost">
      <ClockIcon />
      <span className={collapsible ? "in-data-[compact=true]:hidden" : undefined}>{labels.timestamps}</span>
    </Button>
  );
}
