import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { RPC_ERROR_CODES, RpcPeer, rpcFailure, unrestrictedAccess, type AccessContext } from "@aicontainer/ragents";
import { RpcConnection, type RpcDispatcher } from "./dispatcher.js";

export interface StdioTransportOptions {
  dispatcher: RpcDispatcher;
  input: Readable;
  output: Writable;
  access?: AccessContext;
}

export interface StdioTransport {
  connection: RpcConnection;
  closed: Promise<void>;
  close: (reason: string) => void;
}

/** JSON-RPC über stdin und stdout, eine Nachricht je Zeile; der Aufrufer gilt als vertraut. */
export const startStdioTransport = (options: StdioTransportOptions): StdioTransport => {
  const write = (message: unknown) => new Promise<void>((resolve, reject) => {
    options.output.write(`${JSON.stringify(message)}\n`, (error) => error ? reject(error) : resolve());
  });
  const peer = new RpcPeer({ send: write });
  const connection = new RpcConnection({ id: "stdio", access: options.access ?? unrestrictedAccess, local: true, peer }, options.dispatcher);
  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  let settle: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => { settle = resolve; });
  const close = (reason: string) => {
    lines.close();
    connection.close(reason);
    settle();
  };
  lines.on("line", (line) => {
    if (!line.trim()) return;
    try {
      peer.receive(JSON.parse(line));
    } catch {
      void write(rpcFailure(null, RPC_ERROR_CODES.parse, "Die Zeile enthält kein gültiges JSON")).catch(() => undefined);
    }
  });
  lines.on("close", () => close("Die Eingabe wurde geschlossen"));
  return { connection, closed, close };
};
