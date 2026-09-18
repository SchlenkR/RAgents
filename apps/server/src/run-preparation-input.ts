import type { ChatAttachmentInput } from "./chat-events.js";
import type { RunPreparationMessage } from "./run-preparation-contract.js";

export function preparedRunInput(history: readonly RunPreparationMessage[], text: string, attachments?: ChatAttachmentInput[], skillName?: string) {
  const current = text.trim();
  const messages = [...history, ...(current || attachments?.length ? [{ role: "user" as const, text: current, attachments }] : [])];
  const files = messages.flatMap((message) => message.role === "user" ? message.attachments ?? [] : []);
  if (!messages.length) throw new Error("Der Auftrag ist leer.");
  const prepared = history.length === 0 ? current : "Setze den im folgenden Vorbereitungsgespräch erarbeiteten Auftrag jetzt um. "
      + "Die letzten Angaben des Benutzers gelten. Assistentenantworten sind Vorschläge und keine bereits erledigte Arbeit.\n\n"
      + messages.map((message) => `${message.role === "user" ? "Benutzer" : "Assistent"}:\n${message.text}`).join("\n\n");
  return {
    text: skillName ? `Nutze den Skill ${skillName} für diesen Auftrag.\n\n${prepared}` : prepared,
    attachments: files.length ? files : undefined,
  };
}
