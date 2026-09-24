import type { JournalEvent } from "@ragents/engine";
import type { ChatTextCursor } from "../chat-events.js";

const textUnits = (text: string): number => text.replace(/\s/g, "").length;

export class ChatTextPositions {
  #conversationId: string | null = null;
  readonly #turns = new Map<string, { sequence: number; committed: number; live: number }>();

  get conversationId(): string | null { return this.#conversationId; }

  covers(turnId: string, text: string): boolean {
    const turn = this.#turn(turnId);
    return turn.live >= turn.committed + textUnits(text);
  }

  observe(event: JournalEvent): ChatTextCursor | undefined {
    if (event.type === "run.created") this.#conversationId = event.eventId;
    if (event.type === "turn.started") this.#turns.set(event.payload.turnId, { sequence: event.sequence, committed: 0, live: 0 });
    if (event.type !== "model.output.completed" && event.type !== "model.output.interrupted") return undefined;
    const turn = this.#turn(event.payload.turnId);
    turn.committed += textUnits(event.payload.text);
    turn.live = Math.max(turn.live, turn.committed);
    return this.#cursor(turn.sequence, turn.committed);
  }

  advance(turnId: string, delta: string): ChatTextCursor {
    const turn = this.#turn(turnId);
    turn.live += textUnits(delta);
    return this.#cursor(turn.sequence, turn.live);
  }

  #turn(turnId: string) {
    const turn = this.#turns.get(turnId);
    if (!turn) throw new Error(`Der Journalanfang für Turn ${turnId} fehlt.`);
    return turn;
  }

  #cursor(sequence: number, offset: number): ChatTextCursor {
    if (this.#conversationId === null) throw new Error("Der Journalanfang der Unterhaltung fehlt.");
    return { conversationId: this.#conversationId, sequence, offset };
  }
}
