import { useChatSteps, type ChatStepScope } from "./PluginRegistry";
import { DetailModeSwitch } from "./chat/DetailModeSwitch";
import { TimestampSwitch } from "./chat/TimestampSwitch";
import type { DetailMode } from "./chat/types";
import { createLocalStorageSetting } from "./lib/local-storage-setting";

const timestampSetting = createLocalStorageSetting({
  changeEvent: "ragents-chat-timestamps-change",
  matchesKey: (key) => key.startsWith("ragents.chat.timestamps:"),
  parse: (raw: string | null) => {
    if (raw === null || raw === "true") return true;
    if (raw === "false") return false;
    throw new Error("Die gespeicherte Zeitstempel-Einstellung ist ungültig.");
  },
  serialize: JSON.stringify,
});

export interface ChatViewSettings {
  readonly detailSelectable: boolean;
  readonly detailMode: DetailMode;
  readonly setDetailMode: (mode: DetailMode) => void;
  readonly stepsExpandable: boolean;
  readonly showTimestamps: boolean;
  readonly setShowTimestamps: (showTimestamps: boolean) => void;
}

/** Detailgrad und Zeitstempel eines Chats; display trennt nur den Detailgrad nach Anzeigeort, die Zeitstempel gelten je Run und Actor. */
export function useChatViewSettings(runId: string, actorId: string, scope: ChatStepScope, display?: string): ChatViewSettings {
  const steps = useChatSteps(runId, actorId, display);
  const timestampKey = `ragents.chat.timestamps:${JSON.stringify([runId, actorId])}`;
  return {
    detailSelectable: steps.selectable,
    detailMode: steps.mode(scope),
    setDetailMode: (mode) => steps.setMode(scope, mode),
    stepsExpandable: steps.stepsExpandable,
    showTimestamps: timestampSetting.useValue(timestampKey),
    setShowTimestamps: (showTimestamps) => timestampSetting.save(timestampKey, showTimestamps),
  };
}

/** Die Schalter jeder Chat-Eingabe; collapsible gilt für die Beschriftung des Detailgrads. */
export function ChatViewSwitches({ settings, collapsible = true, className }: {
  settings: ChatViewSettings;
  collapsible?: boolean;
  className?: string;
}) {
  return <>
    {settings.detailSelectable && <DetailModeSwitch className={className} collapsible={collapsible} mode={settings.detailMode} onChange={settings.setDetailMode} />}
    <TimestampSwitch className={className} onChange={settings.setShowTimestamps} showTimestamps={settings.showTimestamps} />
  </>;
}
