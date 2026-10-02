import type { CommandRecord } from "@ragents/engine";

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Questions of ragents.ask carry a list of questions since 2026-10-02; journals with the former single question are not migrated. */
export const assertCurrentQuestionShape = (record: CommandRecord): void => {
  for (const event of record.events) {
    if (event.type !== "action.proposed" || event.payload.owner !== "ragents.ask") continue;
    const payload = recordOf(event.payload.payload);
    if (typeof payload?.question !== "string" || Array.isArray(payload.questions)) continue;
    throw new Error(`This run contains a question of ragents.ask in the removed single-question shape (action ${event.payload.actionId}); `
      + "questions now come as a list. Start a new run; the original files are kept.");
  }
};
