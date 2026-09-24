import { Type } from "typebox";
import { actorByReference, defineRunFunction, defineToolAvailability, holdsUsable, type JournalEvent, type Orchestration, type RunFunction } from "@ragents/engine";

export interface CompactTranscript { text: string; lines: number; truncated: boolean }

const defaultMaxChars = 20_000;
const markerReserve = 50;
const collapse = (text: string, limit: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 3)}...` : flat;
};
const compactJson = (value: unknown, limit: number): string => collapse(typeof value === "string" ? value : JSON.stringify(value) ?? "", limit);

const lineOf = (event: JournalEvent, actorId: string): string | undefined => {
  if (event.type === "actor.input.enqueued") {
    if (event.payload.actorId !== actorId) return undefined;
    return event.payload.content === undefined ? `> [Ereignis ${event.payload.sourceEventIds[0]}]` : `> ${collapse(event.payload.content, 1000)}`;
  }
  if (event.actorId !== actorId) return undefined;
  switch (event.type) {
    case "model.output.completed": return event.payload.text.trim() ? collapse(event.payload.text, 4000) : undefined;
    case "tool.call.started": return `[${event.payload.name}] ${compactJson(event.payload.input, 200)}`;
    case "tool.call.completed": return `  -> ${compactJson(event.payload.output, 300)}`;
    case "tool.call.failed": return `  -> Fehler: ${collapse(event.payload.error, 300)}`;
    case "turn.finished": return event.payload.outcome === "failed" ? `[Turn fehlgeschlagen: ${collapse(event.payload.reason, 300)}]` : undefined;
    case "turn.interrupted": return `[Turn unterbrochen: ${collapse(event.payload.reason, 300)}]`;
    default: return undefined;
  }
};

export function compactTranscript(events: readonly JournalEvent[], actorId: string, maxChars = defaultMaxChars): CompactTranscript {
  const lines = events.map((event) => lineOf(event, actorId)).filter((line): line is string => line !== undefined);
  const total = lines.reduce((sum, line) => sum + line.length + 1, 0);
  if (total <= maxChars) return { text: lines.join("\n"), lines: lines.length, truncated: false };
  let dropped = 0;
  let remaining = total;
  while (dropped < lines.length && remaining + markerReserve > maxChars) {
    remaining -= lines[dropped]!.length + 1;
    dropped += 1;
  }
  const kept = lines.slice(dropped);
  return { text: [`[... ${dropped} frühere Zeilen ausgelassen]`, ...kept].join("\n"), lines: kept.length, truncated: true };
}

export const transcriptToolMetadata = {
  name: "actor_transcript",
  label: "Verlauf verdichten",
  description: "Liefert den Verlauf eines Actors dieses Runs als kompaktes Transkript: Eingaben, Antworttexte und Werkzeugaufrufe je eine Zeile, Ergebnisse gekürzt, ohne Reasoning. Für Übergaben, Statusberichte und Zusammenfassungen.",
} as const;

export const canReadTranscripts = defineToolAvailability({
  availability: "conditional",
  availabilityDetail: "Für Agenten und Skript-Actors mit der Capability event.subscribe.",
}, (actor) => actor.kind !== "human" && holdsUsable(actor, "event.subscribe"));

export const createTranscriptTool = (runtime: () => Orchestration): RunFunction =>
  defineRunFunction({
    ...transcriptToolMetadata,
    schema: Type.Object({
      actor: Type.String({ minLength: 1, description: "Handle mit oder ohne @ oder ID eines Actors dieses Runs" }),
      maxChars: Type.Optional(Type.Integer({ minimum: 200, maximum: 200_000, description: `Obergrenze in Zeichen, Standard ${defaultMaxChars}; die ältesten Zeilen entfallen zuerst` })),
    }, { additionalProperties: false }),
    resultSchema: Type.Object({
      actorId: Type.String(),
      handle: Type.String(),
      text: Type.String(),
      lines: Type.Integer({ minimum: 0 }),
      truncated: Type.Boolean(),
    }, { additionalProperties: false }),
    available: canReadTranscripts,
    run: ({ caller }, _toolCallId, input) => {
      const view = runtime().view(caller.runId);
      const actor = actorByReference(view.actors, input.actor);
      if (!actor) throw new Error(`Unbekannter Actor in diesem Run: ${input.actor}`);
      return { actorId: actor.id, handle: actor.handle, ...compactTranscript(runtime().events(caller.runId), actor.id, input.maxChars) };
    },
  });
