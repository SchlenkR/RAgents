import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  isRpcMessage,
  isRpcRequest,
  isRpcResponse,
  RPC_ERROR_CODES,
  RPC_METHODS,
  RpcPeer,
  rpcFailure,
  type AccessContext,
  type RpcMessage,
} from "@ragents/engine";
import { PayloadTooLargeError, readBody, writeJson } from "../plugin-support/http.js";
import { RpcConnection, type RpcDispatcher } from "./dispatcher.js";

export const RPC_PATH = "/rpc";
export const RPC_STREAM_PATH = "/rpc/stream";
export const RPC_CONNECTION_HEADER = "x-ragents-connection";

const PING_INTERVAL_MS = 15_000;
const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024;

interface StreamConnection {
  connection: RpcConnection;
  response: ServerResponse;
  ping: NodeJS.Timeout;
}

export interface RpcHttpTransportOptions {
  dispatcher: RpcDispatcher;
  maxBodyBytes?: number;
}

/** JSON-RPC über HTTP: Anfragen per POST, Benachrichtigungen und Anfragen des Servers über einen SSE-Strom je Verbindung. */
export class RpcHttpTransport {
  readonly #dispatcher: RpcDispatcher;
  readonly #maxBodyBytes: number;
  readonly #streams = new Map<string, StreamConnection>();

  constructor(options: RpcHttpTransportOptions) {
    this.#dispatcher = options.dispatcher;
    this.#maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  }

  connectionCount(): number {
    return this.#streams.size;
  }

  async handle(request: IncomingMessage, response: ServerResponse, url: URL, access: AccessContext, local: boolean): Promise<boolean> {
    if (url.pathname === RPC_STREAM_PATH) {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        writeJson(response, 405, { error: "Methode nicht erlaubt" });
        return true;
      }
      this.#openStream(request, response, access, local);
      return true;
    }
    if (url.pathname !== RPC_PATH) return false;
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      writeJson(response, 405, { error: "Methode nicht erlaubt" });
      return true;
    }
    await this.#post(request, response, access, local);
    return true;
  }

  close(): void {
    for (const stream of [...this.#streams.values()]) this.#end(stream, "Der Server wird beendet");
  }

  #openStream(request: IncomingMessage, response: ServerResponse, access: AccessContext, local: boolean): void {
    const id = randomBytes(16).toString("hex");
    const write = (payload: string) => {
      if (!response.writableEnded && !response.destroyed) response.write(payload);
    };
    const peer = new RpcPeer({ send: (message) => write(`data: ${JSON.stringify(message)}\n\n`) });
    const connection = new RpcConnection({ id, access, local, peer }, this.#dispatcher);
    const stream: StreamConnection = { connection, response, ping: setInterval(() => write(": ping\n\n"), PING_INTERVAL_MS) };
    this.#streams.set(id, stream);
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    write(`event: hello\ndata: ${JSON.stringify({ connection: id })}\n\n`);
    request.on("close", () => this.#end(stream, "Der Ereignisstrom wurde beendet"));
  }

  #end(stream: StreamConnection, reason: string): void {
    if (!this.#streams.delete(stream.connection.id)) return;
    clearInterval(stream.ping);
    stream.connection.close(reason);
    if (!stream.response.writableEnded) stream.response.end();
  }

  #streamFor(request: IncomingMessage, access: AccessContext): StreamConnection | undefined {
    const header = request.headers[RPC_CONNECTION_HEADER];
    const id = Array.isArray(header) ? header[0] : header;
    if (!id) return undefined;
    const stream = this.#streams.get(id);
    if (!stream) throw new DomainRejection(404, "unknown-connection", "Die Ereignisverbindung ist unbekannt oder beendet.");
    if (stream.connection.userId !== (access.user?.id ?? null)) throw new DomainRejection(403, "foreign-connection", "Die Ereignisverbindung gehört einem anderen Benutzer.");
    return stream;
  }

  async #post(request: IncomingMessage, response: ServerResponse, access: AccessContext, local: boolean): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(await readBody(request, this.#maxBodyBytes));
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        writeJson(response, 413, rpcFailure(null, RPC_ERROR_CODES.invalidRequest, error.message));
        return;
      }
      writeJson(response, 400, rpcFailure(null, RPC_ERROR_CODES.parse, "Der Request enthält kein gültiges JSON"));
      return;
    }
    if (!isRpcMessage(message)) {
      writeJson(response, 400, rpcFailure(null, RPC_ERROR_CODES.invalidRequest, "Die Nachricht ist kein gültiges JSON-RPC"));
      return;
    }
    let stream: StreamConnection | undefined;
    try {
      stream = this.#streamFor(request, access);
    } catch (error) {
      if (error instanceof DomainRejection) {
        writeJson(response, error.status, rpcFailure(isRpcRequest(message) ? message.id : null, RPC_ERROR_CODES.application, error.message, { code: error.code, status: error.status }));
        return;
      }
      throw error;
    }
    if (!isRpcRequest(message)) {
      if (!stream) {
        writeJson(response, 409, rpcFailure(null, RPC_ERROR_CODES.invalidRequest, "Benachrichtigungen und Antworten brauchen einen Ereignisstrom."));
        return;
      }
      stream.connection.peer.receive(message);
      response.writeHead(202, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    await this.#answer(request, response, message, stream, access, local);
  }

  /** Eine Anfrage bekommt ihren eigenen Peer, dessen Antwort die HTTP-Antwort ist; Abonnements landen auf dem Strom. */
  #answer(request: IncomingMessage, response: ServerResponse, message: RpcMessage, stream: StreamConnection | undefined, access: AccessContext, local: boolean): Promise<void> {
    return new Promise<void>((resolve) => {
      let answered = false;
      const peer = new RpcPeer({
        send: (reply) => {
          if (!isRpcResponse(reply)) {
            stream?.connection.peer.notify(reply.method, reply.params);
            return;
          }
          if (answered) return;
          answered = true;
          writeJson(response, 200, reply);
          resolve();
        },
      });
      const target = stream?.connection ?? new RpcConnection({ id: `request-${randomBytes(8).toString("hex")}`, access, local, peer, streamless: true }, this.#dispatcher);
      peer.fallback((method, params, context) => this.#dispatcher.dispatch(target, method, params, context));
      request.on("close", () => {
        if (answered) return;
        peer.receive({ jsonrpc: "2.0", method: RPC_METHODS.cancel, params: { id: (message as { id: unknown }).id } });
      });
      response.on("close", () => { if (!answered) { answered = true; resolve(); } });
      peer.receive(message);
    });
  }
}

class DomainRejection extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}
