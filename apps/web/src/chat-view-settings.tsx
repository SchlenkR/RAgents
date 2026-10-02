import { useChatSteps, type ChatStepScope } from "./PluginRegistry";
import { DetailModeSwitch, TimestampSwitch, TranscriptModeSwitch, type DetailMode, type TranscriptMode } from "quassel";
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

const transcriptSetting = createLocalStorageSetting<TranscriptMode | null>({
  changeEvent: "ragents-chat-transcript-change",
  matchesKey: (key) => key.startsWith("ragents.chat.transcript:"),
  parse: (raw: string | null) => {
    if (raw === null) return null;
    if (raw === "all" || raw === "latest") return raw;
    throw new Error("The saved transcript setting is invalid.");
  },
  serialize: (mode) => mode ?? "",
});

export interface ChatViewSettings {
  readonly detailSelectable: boolean;
  readonly detailMode: DetailMode;
  readonly setDetailMode: (mode: DetailMode) => void;
  readonly stepsExpandable: boolean;
  readonly transcriptMode: TranscriptMode;
  readonly setTranscriptMode: (mode: TranscriptMode) => void;
  readonly showTimestamps: boolean;
  readonly setShowTimestamps: (showTimestamps: boolean) => void;
}

/** Detail level, transcript mode and timestamps of a chat; display separates only the detail level by display location, the others apply per run and actor. */
export function useChatViewSettings(runId: string, actorId: string, scope: ChatStepScope, display?: string, defaultTranscript: TranscriptMode = "all"): ChatViewSettings {
  const steps = useChatSteps(runId, actorId, display);
  const timestampKey = `ragents.chat.timestamps:${JSON.stringify([runId, actorId])}`;
  const transcriptKey = `ragents.chat.transcript:${JSON.stringify([runId, actorId])}`;
  return {
    detailSelectable: steps.selectable,
    detailMode: steps.mode(scope),
    setDetailMode: (mode) => steps.setMode(scope, mode),
    stepsExpandable: steps.stepsExpandable,
    transcriptMode: transcriptSetting.useValue(transcriptKey) ?? defaultTranscript,
    setTranscriptMode: (mode) => transcriptSetting.save(transcriptKey, mode),
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
    <TranscriptModeSwitch className={className} mode={settings.transcriptMode} onChange={settings.setTranscriptMode} />
    <TimestampSwitch className={className} onChange={settings.setShowTimestamps} showTimestamps={settings.showTimestamps} />
  </>;
}
