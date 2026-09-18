import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { DomainError, type AccessContext } from "@aicontainer/ragents";
import { readJsonBody, writeJson } from "./plugin-support/http.js";

export type ChannelEmit = (data: unknown) => void;

export interface EventChannelProvider {
  id: string;
  matches: (channel: string) => boolean;
  requiredRights: (channel: string) => readonly string[];
  open: (channel: string, emit: ChannelEmit, access: AccessContext) => (() => void) | Promise<() => void>;
}

export interface EventChannelRegistry {
  channels: (...providers: EventChannelProvider[]) => void;
}

interface Connection {
  id: string;
  userId: string | null;
  response: ServerResponse;
  subscriptions: Map<string, () => void>;
  ping: NodeJS.Timeout;
}

export const EVENT_HUB_PATH = "/api/events";
const PING_INTERVAL_MS = 15_000;
const MAX_CHANNELS_PER_CONNECTION = 64;
const MAX_CHANNEL_LENGTH = 200;
const connectionPattern = /^\/api\/events\/([a-f0-9]{32})\/subscriptions(?:\/(.+))?$/;

const channelOf = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_CHANNEL_LENGTH || /[\r\n]/.test(value)) {
    throw new DomainError("invalid-channel", "channel fehlt oder ist ungültig.", 400);
  }
  return value;
};

export class EventHub implements EventChannelRegistry {
  readonly #providers: EventChannelProvider[] = [];
  readonly #connections = new Map<string, Connection>();

  channels(...providers: EventChannelProvider[]): void {
    for (const provider of providers) {
      if (this.#providers.some((entry) => entry.id === provider.id)) throw new Error(`Der Ereigniskanal ${provider.id} ist bereits registriert.`);
      this.#providers.push(provider);
    }
  }

  connectionCount(): number {
    return this.#connections.size;
  }

  async handle(request: IncomingMessage, response: ServerResponse, url: URL, access: AccessContext): Promise<boolean> {
    if (url.pathname === EVENT_HUB_PATH) {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        writeJson(response, 405, { error: "Methode nicht erlaubt" });
        return true;
      }
      this.#open(request, response, access);
      return true;
    }
    const match = url.pathname.match(connectionPattern);
    if (!match) return false;
    const [, connectionId, encodedChannel] = match;
    try {
      const connection = this.#connections.get(connectionId!);
      if (!connection) throw new DomainError("unknown-connection", "Die Ereignisverbindung ist unbekannt oder beendet.", 404);
      if (connection.userId !== (access.user?.id ?? null)) throw new DomainError("foreign-connection", "Die Ereignisverbindung gehört einem anderen Benutzer.", 403);
      if (request.method === "POST" && encodedChannel === undefined) {
        const channel = await readJsonBody(request, (body) => channelOf((body as { channel?: unknown } | null)?.channel));
        await this.#subscribe(connection, channel, access);
        writeJson(response, 200, { subscribed: true, channel });
        return true;
      }
      if (request.method === "DELETE" && encodedChannel !== undefined) {
        const channel = decodeURIComponent(encodedChannel);
        const stop = connection.subscriptions.get(channel);
        connection.subscriptions.delete(channel);
        stop?.();
        writeJson(response, 200, { subscribed: false, channel });
        return true;
      }
      response.setHeader("Allow", encodedChannel === undefined ? "POST" : "DELETE");
      writeJson(response, 405, { error: "Methode nicht erlaubt" });
    } catch (error) {
      writeJson(response, error instanceof DomainError ? error.status : 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  close(): void {
    for (const connection of [...this.#connections.values()]) this.#end(connection);
  }

  #open(request: IncomingMessage, response: ServerResponse, access: AccessContext): void {
    const connection: Connection = {
      id: randomBytes(16).toString("hex"),
      userId: access.user?.id ?? null,
      response,
      subscriptions: new Map(),
      ping: setInterval(() => this.#write(response, ": ping\n\n"), PING_INTERVAL_MS),
    };
    this.#connections.set(connection.id, connection);
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    this.#write(response, `event: hello\ndata: ${JSON.stringify({ connection: connection.id })}\n\n`);
    request.on("close", () => this.#end(connection));
  }

  async #subscribe(connection: Connection, channel: string, access: AccessContext): Promise<void> {
    if (connection.subscriptions.has(channel)) return;
    const provider = this.#providers.find((entry) => entry.matches(channel));
    if (!provider) throw new DomainError("unknown-channel", `Unbekannter Ereigniskanal: ${channel}`, 400);
    const missing = provider.requiredRights(channel).find((right) => !access.can(right));
    if (missing) throw new DomainError("access-denied", `Das Recht ${missing} fehlt.`, 403);
    if (connection.subscriptions.size >= MAX_CHANNELS_PER_CONNECTION) throw new DomainError("too-many-channels", "Zu viele Ereigniskanäle auf einer Verbindung.", 429);
    const emit: ChannelEmit = (data) => {
      if (!connection.subscriptions.has(channel) && !pending) return;
      this.#write(connection.response, `data: ${JSON.stringify({ channel, data })}\n\n`);
    };
    let pending = true;
    const stop = await provider.open(channel, emit, access);
    pending = false;
    if (!this.#connections.has(connection.id)) {
      stop();
      throw new DomainError("connection-closed", "Die Ereignisverbindung wurde beendet.", 410);
    }
    connection.subscriptions.set(channel, stop);
  }

  #write(response: ServerResponse, payload: string): void {
    if (!response.writableEnded && !response.destroyed) response.write(payload);
  }

  #end(connection: Connection): void {
    if (!this.#connections.delete(connection.id)) return;
    clearInterval(connection.ping);
    for (const stop of connection.subscriptions.values()) stop();
    connection.subscriptions.clear();
    if (!connection.response.writableEnded) connection.response.end();
  }
}
