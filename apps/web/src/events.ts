import { errorFrom } from "./lib/http";
import { withAccessToken } from "./access-token";

export interface ChannelSubscription {
  channel: string;
  onMessage: (data: unknown) => void;
  onError?: (message: string) => void;
}

export interface EventHubLike {
  subscribe: (subscription: ChannelSubscription) => () => void;
}

const HUB_PATH = "/api/events";

class BrowserEventHub implements EventHubLike {
  #source: EventSource | undefined;
  #connection: string | undefined;
  readonly #subscriptions = new Set<ChannelSubscription>();
  readonly #registered = new Set<string>();
  readonly #operations = new Map<string, Promise<void>>();

  subscribe(subscription: ChannelSubscription): () => void {
    this.#subscriptions.add(subscription);
    if (!this.#source) this.#open();
    else this.#ensure(subscription.channel);
    return () => {
      if (!this.#subscriptions.delete(subscription)) return;
      if (this.#subscriptions.size === 0) {
        this.#close();
        return;
      }
      if (![...this.#subscriptions].some((entry) => entry.channel === subscription.channel)) this.#release(subscription.channel);
    };
  }

  #open(): void {
    const source = new EventSource(withAccessToken(HUB_PATH));
    this.#source = source;
    source.addEventListener("hello", (event) => {
      this.#connection = (JSON.parse((event as MessageEvent<string>).data) as { connection: string }).connection;
      this.#registered.clear();
      for (const channel of new Set([...this.#subscriptions].map((entry) => entry.channel))) this.#ensure(channel);
    });
    source.onmessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as { channel: string; data: unknown };
      for (const entry of [...this.#subscriptions]) if (entry.channel === message.channel) entry.onMessage(message.data);
    };
    source.onerror = () => {
      this.#connection = undefined;
      this.#registered.clear();
      this.#notify("Die Live-Verbindung zum Server ist unterbrochen");
    };
  }

  #close(): void {
    this.#source?.close();
    this.#source = undefined;
    this.#connection = undefined;
    this.#registered.clear();
    this.#operations.clear();
  }

  #queue(channel: string, task: () => Promise<void>): void {
    const previous = this.#operations.get(channel) ?? Promise.resolve();
    const operation = previous.then(task, task).catch(() => undefined);
    this.#operations.set(channel, operation);
    void operation.finally(() => {
      if (this.#operations.get(channel) === operation) this.#operations.delete(channel);
    });
  }

  #ensure(channel: string): void {
    this.#queue(channel, async () => {
      const connection = this.#connection;
      if (!connection || this.#registered.has(channel) || ![...this.#subscriptions].some((entry) => entry.channel === channel)) return;
      try {
        const response = await fetch(`${HUB_PATH}/${connection}/subscriptions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel }),
        });
        if (this.#connection !== connection) return;
        if (response.ok) this.#registered.add(channel);
        else this.#notify((await errorFrom(response, "Der Ereigniskanal konnte nicht abonniert werden")).message, channel);
      } catch {
        if (this.#connection === connection) this.#notify("Der Ereigniskanal konnte nicht abonniert werden", channel);
      }
    });
  }

  #release(channel: string): void {
    this.#queue(channel, async () => {
      const connection = this.#connection;
      if (!connection || !this.#registered.delete(channel)) return;
      await fetch(`${HUB_PATH}/${connection}/subscriptions/${encodeURIComponent(channel)}`, { method: "DELETE" }).catch(() => undefined);
    });
  }

  #notify(message: string, channel?: string): void {
    for (const entry of [...this.#subscriptions]) if (channel === undefined || entry.channel === channel) entry.onError?.(message);
  }
}

export const eventHub: EventHubLike = new BrowserEventHub();
