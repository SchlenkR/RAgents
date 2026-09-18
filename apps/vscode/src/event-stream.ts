import { createParser, type EventSourceMessage } from "eventsource-parser";
import type { ServerClient } from "./server-client";

export type StreamStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "unauthorized" }
  | { kind: "retrying"; message: string; at: number };

export interface StreamSubscription {
  channel: string;
  onMessage: (data: unknown) => void;
}

const RETRY_DELAY_MS = 5000;

/** Ein Ereignisstrom je Erweiterung, wie apps/web/src/events.ts im Browser: erst hello, dann Kanäle anmelden. */
export class EventStream {
  #subscriptions = new Set<StreamSubscription>();
  #controller: AbortController | undefined;
  #connection: string | undefined;
  #registered = new Set<string>();
  #retry: ReturnType<typeof setTimeout> | undefined;
  #status: StreamStatus = { kind: "idle" };

  constructor(private readonly client: ServerClient, private readonly onStatus: (status: StreamStatus) => void) {}

  get status(): StreamStatus {
    return this.#status;
  }

  subscribe(subscription: StreamSubscription): () => void {
    this.#subscriptions.add(subscription);
    if (!this.#controller) this.#open();
    else void this.#ensure(subscription.channel);
    return () => {
      if (!this.#subscriptions.delete(subscription)) return;
      if (this.#subscriptions.size === 0) this.close();
      else if (![...this.#subscriptions].some((entry) => entry.channel === subscription.channel)) void this.#release(subscription.channel);
    };
  }

  /** Nach Anmeldung oder Serverwechsel: bestehende Abonnements auf einer frischen Verbindung weiterführen. */
  reconnect(): void {
    this.#stop();
    if (this.#subscriptions.size > 0) this.#open();
  }

  close(): void {
    this.#stop();
    this.#set({ kind: "idle" });
  }

  #set(status: StreamStatus): void {
    this.#status = status;
    this.onStatus(status);
  }

  #stop(): void {
    if (this.#retry !== undefined) clearTimeout(this.#retry);
    this.#retry = undefined;
    this.#controller?.abort();
    this.#controller = undefined;
    this.#connection = undefined;
    this.#registered.clear();
  }

  #open(): void {
    const controller = new AbortController();
    this.#controller = controller;
    this.#set({ kind: "connecting" });
    void this.#run(controller).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      this.#scheduleRetry(cause instanceof Error ? cause.message : String(cause));
    });
  }

  async #run(controller: AbortController): Promise<void> {
    const response = await this.client.fetch("/api/events", { headers: { accept: "text/event-stream" }, signal: controller.signal });
    if (response.status === 401) {
      this.#controller = undefined;
      this.#set({ kind: "unauthorized" });
      return;
    }
    if (!response.ok || !response.body) throw new Error(`Der Ereignisstrom antwortete mit ${response.status}.`);
    const parser = createParser({ onEvent: (event) => this.#handle(event) });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
    if (!controller.signal.aborted) this.#scheduleRetry("Der Server hat den Ereignisstrom beendet.");
  }

  #handle(event: EventSourceMessage): void {
    if (event.event === "hello") {
      this.#connection = (JSON.parse(event.data) as { connection: string }).connection;
      this.#registered.clear();
      this.#set({ kind: "connected" });
      for (const channel of new Set([...this.#subscriptions].map((entry) => entry.channel))) void this.#ensure(channel);
      return;
    }
    const message = JSON.parse(event.data) as { channel: string; data: unknown };
    for (const entry of [...this.#subscriptions]) if (entry.channel === message.channel) entry.onMessage(message.data);
  }

  async #ensure(channel: string): Promise<void> {
    const connection = this.#connection;
    if (!connection || this.#registered.has(channel)) return;
    this.#registered.add(channel);
    try {
      await this.client.subscribe(connection, channel);
    } catch (cause) {
      this.#registered.delete(channel);
      if (this.#connection === connection) this.#scheduleRetry(`Kanal ${channel}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  async #release(channel: string): Promise<void> {
    const connection = this.#connection;
    if (!connection || !this.#registered.delete(channel)) return;
    await this.client.unsubscribe(connection, channel);
  }

  #scheduleRetry(message: string): void {
    this.#stop();
    this.#set({ kind: "retrying", message, at: Date.now() + RETRY_DELAY_MS });
    this.#retry = setTimeout(() => {
      this.#retry = undefined;
      if (this.#subscriptions.size > 0) this.#open();
    }, RETRY_DELAY_MS);
  }
}
