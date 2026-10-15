import type { IncomingMessage } from "node:http";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export const isLocalRequest = (req: IncomingMessage): boolean => {
  const header = req.headers.host ?? "";
  const bracketed = /^\[(.+)\]/.exec(header);
  return LOCAL_HOSTS.has((bracketed ? bracketed[1] : header.split(":")[0] ?? "").toLowerCase());
};

export const isLoopbackRequest = (req: IncomingMessage): boolean => {
  const address = req.socket.remoteAddress;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
};

/** From this machine: over loopback, or through one of its own addresses, where the peer is the address the request arrived at. */
export const isSameMachineRequest = (req: IncomingMessage): boolean =>
  isLoopbackRequest(req) || (req.socket.remoteAddress !== undefined && req.socket.remoteAddress === req.socket.localAddress);
