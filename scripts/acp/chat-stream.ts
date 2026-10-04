import { RequestError, type AgentSideConnection, type StopReason } from "@agentclientprotocol/sdk";
import type { ChatEvent } from "quassel/events";
import { coreContracts } from "../../apps/server/src/api/contracts.ts";
import type { RpcClient } from "../../apps/web/src/rpc/client.ts";
import { runContracts } from "../../packages/ragents/src/http/contracts.ts";
import { ASK_PLUGIN_ID } from "../../plugins/ragents.ask/ask-payload.ts";
import { chatUpdates } from "./updates.ts";
import { elicitQuestion } from "./questions.ts";

export interface ChatStreamOptions {
  readonly connection: AgentSideConnection;
  readonly rpc: RpcClient;
  readonly runId: string;
  readonly cwd: string;
  readonly replay: boolean;
  readonly elicit: boolean;
  readonly signal: AbortSignal;
  readonly attachment: (event: Extract<ChatEvent, { kind: "user" }>) => Promise<void>;
}

export class ChatStream {
  readonly #ready = Promise.withResolvers<void>();
  readonly #done = Promise.withResolvers<StopReason>();
  readonly #release: () => void;
  readonly #status: () => void;
  readonly #cancel: () => void;
  readonly #deadline: NodeJS.Timeout;
  readonly #toolResults = new Map<string, string>();
  #queue: Promise<void> = Promise.resolve();
  #replaying = true;
  #submitted = false;
  #userSeen = false;
  #skipCompletions = 0;
  #finished = false;

  constructor(readonly options: ChatStreamOptions) {
    void this.#ready.promise.catch(() => undefined);
    void this.#done.promise.catch(() => undefined);
    this.#deadline = setTimeout(() => this.#fail(new Error("The host did not replay the chat within 15 seconds.")), 15_000);
    this.#status = options.rpc.onStatus((status) => {
      if (status.kind === "unauthorized") this.#fail(new Error("The host rejected sign-in; check RAGENTS_TOKEN."));
      if (status.kind === "retrying") this.#fail(new Error(`The host connection was lost: ${status.message}`));
    });
    this.#release = options.rpc.subscribe(coreContracts.channels.chat, { runId: options.runId }, (event) => {
      this.#queue = this.#queue.then(() => this.#event(event)).catch((cause: unknown) => this.#fail(cause));
    }, (cause) => this.#fail(new Error(cause)));
    const cancel = (): void => {
      if (this.#submitted || this.#finished) return;
      this.#finished = true;
      clearTimeout(this.#deadline);
      this.#ready.resolve();
      this.#done.resolve("cancelled");
    };
    options.signal.addEventListener("abort", cancel, { once: true });
    this.#cancel = () => options.signal.removeEventListener("abort", cancel);
    if (options.signal.aborted) cancel();
  }

  ready(): Promise<void> { return this.#ready.promise; }
  done(): Promise<StopReason> { return this.#done.promise; }
  submit(): void { this.#submitted = true; }

  async #event(event: ChatEvent): Promise<void> {
    if (this.#finished) return;
    if (event.kind === "reset") { this.#replaying = true; return; }
    if (event.kind === "replay-end") {
      this.#replaying = false;
      clearTimeout(this.#deadline);
      this.#ready.resolve();
      if (this.options.replay) { this.#finished = true; this.#done.resolve("end_turn"); }
      return;
    }
    if (this.#replaying && !this.options.replay) return;
    if (!this.options.replay && !this.#submitted) return;
    if (event.kind === "tool") this.#toolResults.delete(event.id);
    if (event.kind === "tool-result") {
      const result = JSON.stringify([event.isError, event.result]);
      if (this.#toolResults.get(event.id) === result) return;
      this.#toolResults.set(event.id, result);
    }
    if (event.kind === "user") {
      this.#userSeen = true;
      if (this.options.replay) await this.options.attachment(event);
    }
    const eliciting = event.kind === "action" && event.owner === ASK_PLUGIN_ID && this.options.elicit && !this.options.replay;
    for (const update of eliciting ? [] : chatUpdates(event, this.options.cwd, this.options.replay)) {
      await this.options.connection.sessionUpdate({ sessionId: this.options.runId, update });
    }
    if (event.kind === "action" && eliciting) {
      if (await elicitQuestion(this.options.connection, this.options.rpc, this.options.runId, event.actionId, event.payload, this.options.signal)) this.#skipCompletions += 1;
    }
    if (event.kind === "status" && event.startup?.status === "failed") throw new Error(event.startup.message);
    if (event.kind !== "turn-done" || this.options.replay || !this.#userSeen) return;
    if (this.#skipCompletions > 0) { this.#skipCompletions -= 1; return; }
    const view = await this.options.rpc.call(runContracts.view, { runId: this.options.runId });
    const turn = view?.turns.findLast((turn) => turn.actorId === view.primaryActorId);
    if (!turn) throw new Error("The primary actor ended without a recorded turn.");
    if (turn.status === "running") return;
    if (turn.status === "failed") throw new Error(turn.reason ?? "The primary actor's turn failed.");
    this.#finished = true;
    this.#done.resolve(this.options.signal.aborted || turn.status === "interrupted" ? "cancelled" : "end_turn");
  }

  #fail(cause: unknown): void {
    const error = cause instanceof RequestError ? cause : RequestError.internalError(undefined, cause instanceof Error ? cause.message : String(cause));
    this.#finished = true;
    clearTimeout(this.#deadline);
    this.#ready.reject(error);
    this.#done.reject(error);
  }

  close(): void {
    clearTimeout(this.#deadline);
    this.#release();
    this.#status();
    this.#cancel();
  }
}
