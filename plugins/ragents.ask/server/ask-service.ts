import { randomUUID } from "node:crypto";
import {
  DomainError,
  type Action,
  type CommandContext,
  type JournalEvent,
  type Orchestration,
} from "@ragents/engine";
import { ASK_PLUGIN_ID } from "../ask-payload.js";
import type { AskCall, AskRequest, AskService } from "./contract.js";

export const DISMISSED_ANSWER = "Der Benutzer hat die Frage verworfen.";

const answerOf = (decision: "approved" | "dismissed", result: unknown): string =>
  decision !== "approved" ? DISMISSED_ANSWER : typeof result === "string" ? result : result === null || result === undefined ? "" : JSON.stringify(result);

const resolvedAnswerOf = (action: Action): string | null =>
  action.status === "pending" ? null : answerOf(action.status, action.result);

export class RuntimeAskService implements AskService {
  #runtime: Orchestration | undefined;
  readonly #waiters = new Map<string, (answer: string) => void>();
  readonly #aborting = new Set<string>();

  bind(runtime: Orchestration): void {
    if (this.#runtime) throw new Error("Der Ask-Service wurde bereits an eine Runtime gebunden");
    this.#runtime = runtime;
    runtime.subscribe((events) => this.#onJournal(events));
  }

  ask(call: AskCall, request: AskRequest, signal: AbortSignal | undefined): Promise<string> {
    const runtime = this.#requireRuntime();
    const context: CommandContext = {
      actorId: call.agentId,
      commandId: call.commandId,
      ...(call.turnId ? { turnId: call.turnId, correlationId: call.turnId, causationId: call.turnId } : {}),
    };
    runtime.proposeAction(context, call.runId, {
      owner: ASK_PLUGIN_ID,
      title: request.question,
      description: request.description,
      parameters: request.parameters,
      input: { label: "Antwort", placeholder: null, required: true },
      payload: { question: request.question, options: [...request.options], multi: request.multi === true },
    });
    const proposed = runtime.events(call.runId).find((event) =>
      event.type === "action.proposed" && event.commandId === call.commandId);
    if (proposed?.type !== "action.proposed") {
      throw new Error(`Die Frage von ${call.agentId} wurde nicht im Journal von ${call.runId} angelegt`);
    }
    return this.#awaitAnswer(call.runId, proposed.payload.actionId, signal);
  }

  answer(runId: string, actionId: string, input: { answer?: string; dismiss?: boolean }): void {
    const runtime = this.#requireRuntime();
    const state = runtime.state(runId);
    const action = state.actions.get(actionId);
    if (!action || action.owner !== ASK_PLUGIN_ID) {
      throw new DomainError("question-not-found", `Frage ${actionId} existiert nicht in Run ${runId}.`, 404);
    }
    runtime.resolveAction(
      { actorId: state.ownerId, commandId: `ask-answer:${actionId}:${randomUUID()}` },
      runId,
      actionId,
      input.dismiss === true
        ? { decision: "dismissed", result: null }
        : { decision: "approved", result: input.answer ?? null },
    );
  }

  #awaitAnswer(runId: string, actionId: string, signal: AbortSignal | undefined): Promise<string> {
    const runtime = this.#requireRuntime();
    const action = runtime.state(runId).actions.get(actionId);
    if (!action) throw new Error(`Frage ${actionId} existiert nicht in Run ${runId}`);
    const settled = resolvedAnswerOf(action);
    if (settled !== null) return Promise.resolve(settled);
    return new Promise<string>((resolve, reject) => {
      const abort = () => {
        this.#waiters.delete(actionId);
        this.#aborting.add(actionId);
        try {
          const state = runtime.state(runId);
          const pending = state.actions.get(actionId);
          if (pending?.status === "pending") {
            runtime.resolveAction(
              { actorId: state.ownerId, commandId: `ask-abort:${actionId}:${randomUUID()}` },
              runId,
              actionId,
              { decision: "dismissed", result: null },
            );
          }
          reject(new Error("Das Warten auf die Antwort wurde abgebrochen."));
        } catch (error) {
          reject(error);
        } finally {
          this.#aborting.delete(actionId);
        }
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      this.#waiters.set(actionId, (answer) => {
        signal?.removeEventListener("abort", abort);
        this.#waiters.delete(actionId);
        resolve(answer);
      });
    });
  }

  #onJournal(events: JournalEvent[]): void {
    for (const event of events) {
      if (event.type !== "action.resolved") continue;
      if (this.#aborting.has(event.payload.actionId)) continue;
      const resolved = this.#requireRuntime().state(event.runId).actions.get(event.payload.actionId);
      if (resolved?.owner !== ASK_PLUGIN_ID) continue;
      const answer = answerOf(event.payload.decision, event.payload.result);
      const waiter = this.#waiters.get(event.payload.actionId);
      if (waiter) {
        waiter(answer);
        continue;
      }
      queueMicrotask(() => this.#enqueueAnswer(event.runId, event.payload.actionId, answer));
    }
  }

  #enqueueAnswer(runId: string, actionId: string, answer: string): void {
    try {
      const runtime = this.#requireRuntime();
      const state = runtime.state(runId);
      const action = state.actions.get(actionId);
      if (!action) return;
      const asker = state.actors.get(action.askedBy);
      if (!asker || asker.kind === "human" || asker.lifecycle.kind === "stopped") return;
      runtime.enqueueInput(
        { actorId: state.ownerId, commandId: `ask-input:${actionId}` },
        runId,
        {
          actorId: action.askedBy,
          content: `Antwort auf deine Frage: ${action.title}\nAntwort: ${answer}`,
        },
      );
    } catch (error) {
      console.error(`Antwort auf Frage ${actionId} konnte nicht als Input eingereiht werden: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  #requireRuntime(): Orchestration {
    if (!this.#runtime) throw new Error("Der Ask-Service ist noch nicht an die Runtime gebunden");
    return this.#runtime;
  }
}
