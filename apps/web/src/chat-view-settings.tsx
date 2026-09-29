import { useChatSteps, type ChatStepScope } from "./PluginRegistry";
import { DetailModeSwitch, TimestampSwitch, type DetailMode } from "quassel";
import { createLocalStorageSetting } from "./lib/local-storage-setting";

const timestampSetting = createLocalStorageSetting({
  changeEvent: "ragents-chat-timestamps-change",
  matchesKey: (key) => key.startsWith("ragents.chat.timestamps:"),
  parse: (raw: string | null) => {
    if (raw === null || raw === "true") return true;
    if (raw === "false") return false;
    throw new Error("The saved timestamp setting is invalid.");
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

/** Detail level and timestamps of a chat; display separates only the detail level by display location, the timestamps apply per run and actor. */
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

/** The switches of every chat input. */
export function ChatViewSwitches({ settings, className }: {
  settings: ChatViewSettings;
  className?: string;
}) {
  return <>
    {settings.detailSelectable && <DetailModeSwitch className={className} mode={settings.detailMode} onChange={settings.setDetailMode} />}
    <TimestampSwitch className={className} onChange={settings.setShowTimestamps} showTimestamps={settings.showTimestamps} />
  </>;
}
