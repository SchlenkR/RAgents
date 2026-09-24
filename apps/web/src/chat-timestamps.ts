import { createLocalStorageSetting } from "./lib/local-storage-setting";

const setting = createLocalStorageSetting({
  changeEvent: "ragents-chat-timestamps-change",
  matchesKey: (key) => key.startsWith("ragents.chat.timestamps:"),
  parse: (raw: string | null) => {
    if (raw === null || raw === "true") return true;
    if (raw === "false") return false;
    throw new Error("Die gespeicherte Zeitstempel-Einstellung ist ungültig.");
  },
  serialize: JSON.stringify,
});

export function useChatTimestamps(runId: string, actorId: string) {
  const key = `ragents.chat.timestamps:${JSON.stringify([runId, actorId])}`;
  const showTimestamps = setting.useValue(key);
  return { showTimestamps, setShowTimestamps: (value: boolean) => setting.save(key, value) };
}
