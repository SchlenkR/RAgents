import { randomUUID } from "node:crypto";
import {
  DomainError,
  type CommandContext,
  type JournalEvent,
  type JsonValue,
  type Orchestration,
  type RunState,
} from "@ragents/engine";
import { askPayloadOf, ASK_PLUGIN_ID, SUPERSEDED_ANSWER, supersedingInputOf } from "../ask-payload.js";
import { DISMISSED_ANSWER, type AskCall, type AskRequest, type AskService } from "./contract.js";

const answerOf = (decision: "approved" | "dismissed", result: unknown): string =>
  decision !== "approved"
    ? supersedingInputOf(result) === undefined ? DISMISSED_ANSWER : SUPERSEDED_ANSWER
    : typeof result === "string" ? result : result === null || result === undefined ? "" : JSON.stringify(result);

const humanInputPendingFor = (state: RunState, actorId: string): boolean =>
  [...state.inputs.values()].some((input) =>
    input.actorId === actorId && input.origin === "human" && input.lifecycle.kind === "pending");

/** Open questions an actor asked for itself; a question with a recipient stands for another actor. */
const ownQuestionsOf = (state: RunState, askedBy: (actorId: string) => boolean): string[] =>
  [...state.actions.values()]
    .filter((action) => action.owner === ASK_PLUGIN_ID && action.status === "pending" && askedBy(action.askedBy)
      && askPayloadOf(action.payload)?.recipient === undefined)
    .map((action) => action.id);

/** A locked or already removed journal holds no question that could still be withdrawn, so its deletion goes on. */
const unreadableRun = (error: unknown): boolean =>
  error instanceof DomainError && (error.code === "journal-unavailable" || error.code === "run-not-found");

export class RuntimeAskService implements AskService {
  #runtime: Orchestration | undefined;
  readonly #waiters = new Map<string, (answer: string) => void>();
  readonly #aborting = new Set<string>();

  bind(runtime: Orchestration): void {
    if (this.#runtime) throw new Error("The ask service is already bound to a runtime");
    this.#runtime = runtime;
    runtime.subscribe((events) => this.#onJournal(events));
  }

  pose(call: AskCall, request: AskRequest): string | undefined {
    if (this.#requireRuntime().select(call.runId, (state) => humanInputPendingFor(state, call.agentId))) return undefined;
    return this.#propose(call, request);
  }

  ask(call: AskCall & { turnId: null }, request: AskRequest, signal: AbortSignal | undefined): Promise<string> {
    return this.#awaitAnswer(call.runId, this.#propose(call, request), signal);
  }

  answer(runId: string, actionId: string, input: { answer?: string; dismiss?: boolean }): void {
    const runtime = this.#requireRuntime();
    const state = runtime.state(runId);
    const action = state.actions.get(actionId);
    if (!action || action.owner !== ASK_PLUGIN_ID) {
      throw new DomainError("question-not-found", `Question ${actionId} does not exist in run ${runId}.`, 404);
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

  withdraw(runId: string, actionId: string): void {
    this.#dismiss(runId, actionId, "ask-withdraw", null);
  }

  /** Withdraws every open question an agent of the run asked for itself, on stop and deletion. */
  stopRun(runId: string): void {
    for (const actionId of this.#agentQuestions(runId)) this.withdraw(runId, actionId);
  }

  #agentQuestions(runId: string): string[] {
    try {
      return this.#requireRuntime().select(runId, (state) => ownQuestionsOf(state, (askedBy) => askedBy !== state.ownerId));
    } catch (error) {
      if (unreadableRun(error)) return [];
      throw error;
    }
  }

  #propose(call: AskCall, request: AskRequest): string {
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
      input: { label: "Answer", placeholder: null, required: true },
      payload: {
        question: request.question,
        options: [...request.options],
        multi: request.multi === true,
        ...(request.recipient ? { recipient: request.recipient } : {}),
      },
    });
    const proposed = runtime.events(call.runId).find((event) =>
      event.type === "action.proposed" && event.commandId === call.commandId);
    if (proposed?.type !== "action.proposed") {
      throw new Error(`The question from ${call.agentId} was not created in the journal of ${call.runId}`);
    }
    return proposed.payload.actionId;
  }

  #closeOwnQuestions(runId: string, actorId: string, close: (actionId: string) => void): void {
    try {
      const questions = this.#requireRuntime().select(runId, (state) => ownQuestionsOf(state, (askedBy) => askedBy === actorId));
      for (const actionId of questions) close(actionId);
    } catch (error) {
      console.error(`Open questions of ${actorId} in run ${runId} could not be closed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  #dismiss(runId: string, actionId: string, commandPrefix: string, result: JsonValue): void {
    const runtime = this.#requireRuntime();
    const state = runtime.state(runId);
    const action = state.actions.get(actionId);
    if (action?.owner !== ASK_PLUGIN_ID || action.status !== "pending") return;
    this.#aborting.add(actionId);
    try {
      runtime.resolveAction(
        { actorId: state.ownerId, commandId: `${commandPrefix}:${actionId}:${randomUUID()}` },
        runId,
        actionId,
        { decision: "dismissed", result },
      );
    } finally {
      this.#aborting.delete(actionId);
    }
  }

  #awaitAnswer(runId: string, actionId: string, signal: AbortSignal | undefined): Promise<string> {
    const action = this.#requireRuntime().state(runId).actions.get(actionId);
    if (!action) throw new Error(`Question ${actionId} does not exist in run ${runId}`);
    if (action.status !== "pending") return Promise.resolve(answerOf(action.status, action.result));
    return new Promise<string>((resolve, reject) => {
      const abort = () => {
        this.#waiters.delete(actionId);
        try {
          this.#dismiss(runId, actionId, "ask-abort", null);
          reject(new Error("Waiting for the answer was cancelled."));
        } catch (error) {
          reject(error);
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
      if (event.type === "actor.input.enqueued") {
        if (event.payload.origin !== "human") continue;
        const { actorId, inputId } = event.payload;
        queueMicrotask(() => this.#closeOwnQuestions(event.runId, actorId, (actionId) =>
          this.#dismiss(event.runId, actionId, "ask-supersede", { supersededBy: inputId })));
        continue;
      }
      if (event.type === "actor.stopped") {
        const { actorId } = event.payload;
        queueMicrotask(() => this.#closeOwnQuestions(event.runId, actorId, (actionId) => this.withdraw(event.runId, actionId)));
        continue;
      }
      if (event.type !== "action.resolved") continue;
      const { actionId, decision, result } = event.payload;
      const waiter = this.#waiters.get(actionId);
      if (waiter) {
        waiter(answerOf(decision, result));
        continue;
      }
      if (this.#aborting.has(actionId)) continue;
      const resolved = this.#requireRuntime().state(event.runId).actions.get(actionId);
      if (resolved?.owner !== ASK_PLUGIN_ID) continue;
      queueMicrotask(() => this.#enqueueAnswer(event.runId, actionId, answerOf(decision, result)));
    }
  }

  #enqueueAnswer(runId: string, actionId: string, answer: string): void {
    try {
      const runtime = this.#requireRuntime();
      const state = runtime.state(runId);
      const action = state.actions.get(actionId);
      if (!action) return;
      const recipientId = askPayloadOf(action.payload)?.recipient ?? action.askedBy;
      const recipient = state.actors.get(recipientId);
      if (!recipient || recipient.kind === "human" || recipient.lifecycle.kind === "stopped") return;
      runtime.enqueueInput(
        { actorId: state.ownerId, commandId: `ask-input:${actionId}` },
        runId,
        {
          actorId: recipientId,
          content: `Answer to ${recipientId === action.askedBy ? "your question" : "the question"}: ${action.title}\nAnswer: ${answer}`,
        },
      );
    } catch (error) {
      console.error(`Answer to question ${actionId} could not be enqueued as input: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  #requireRuntime(): Orchestration {
    if (!this.#runtime) throw new Error("The ask service is not bound to the runtime yet");
    return this.#runtime;
  }
}
