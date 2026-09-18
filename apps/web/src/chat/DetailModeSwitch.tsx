import { SparklesIcon } from "lucide-react";
import { Button } from "../ui";
import { DetailMode } from "./types";
import { ChatTexts, defaultTexts } from "./texts";

export const DETAIL_MODES: readonly DetailMode[] = ["off", "current", "icons", "chips", "grouped", "compact", "full"];

const TEXT_KEYS: Record<DetailMode, keyof ChatTexts> = {
  off: "detailModeOff",
  current: "detailModeCurrent",
  icons: "detailModeIcons",
  chips: "detailModeChips",
  grouped: "detailModeGrouped",
  compact: "detailModeCompact",
  full: "detailModeFull",
};

export const detailModeLabel = (mode: DetailMode, texts?: Partial<ChatTexts>): string =>
  ({ ...defaultTexts, ...texts })[TEXT_KEYS[mode]];

/**
 * Ein Knopf, der den Detailgrad der Denk- und Werkzeug-Schritte weiterschaltet. Die
 * Reihenfolge kommt aus `modes`, der aktuelle Wert steht als Beschriftung daneben.
 */
export function DetailModeSwitch({
  mode,
  onChange,
  modes = DETAIL_MODES,
  collapsible = true,
  texts,
  className,
}: {
  mode: DetailMode;
  onChange: (mode: DetailMode) => void;
  /** Auswahl und Reihenfolge des Weiterschaltens; Default sind alle Modi. */
  modes?: readonly DetailMode[];
  /** false = die Beschriftung bleibt auch in einer schmalen Eingabe-Karte stehen. */
  collapsible?: boolean;
  texts?: Partial<ChatTexts>;
  className?: string;
}) {
  const alleTexte = { ...defaultTexts, ...texts };
  const aktuell = modes.indexOf(mode);
  const naechster = modes[(aktuell < 0 ? 0 : aktuell + 1) % modes.length];
  return (
    <Button
      aria-label={`${alleTexte.detailModeTitle}: ${detailModeLabel(mode, texts)}`}
      className={className}
      onClick={() => onChange(naechster)}
      size="sm"
      title={`${alleTexte.detailModeTitle}: ${detailModeLabel(mode, texts)}`}
      variant="ghost"
    >
      <SparklesIcon />
      <span className={collapsible ? "in-data-[compact=true]:hidden" : undefined}>{detailModeLabel(mode, texts)}</span>
    </Button>
  );
}
