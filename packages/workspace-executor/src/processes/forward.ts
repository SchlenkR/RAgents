import { request as httpRequest, type IncomingMessage } from "node:http";
import { WorkspaceOperationError } from "../errors.js";

/** The largest body of a forwarded request and of its response; in Base64 both stay below the 32 MiB message limit of a workstation. */
export const FORWARD_BODY_LIMIT = 16 * 1024 * 1024;

/** How long one forwarded exchange may take, from the connection to the last byte of the response. */
export const FORWARD_TIMEOUT_MS = 60_000;

export type HeaderPair = readonly [name: string, value: string];

/** One HTTP request to a service of the run; headers as pairs because names repeat, the body in Base64. */
export interface ForwardedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: readonly HeaderPair[];
  readonly body: string;
}

export interface ForwardedResponse {
  readonly status: number;
  readonly headers: readonly HeaderPair[];
  readonly body: string;
}

/** Without a request the operation only checks that a process of the run listens on the port. */
export interface ForwardInput {
  readonly port: number;
  readonly request: ForwardedRequest | null;
}

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const LOOPBACK = ["127.0.0.1", "::1"] as const;
const WILDCARD = "*";
const UNREACHED = new Set(["ECONNREFUSED", "EADDRNOTAVAIL", "EAFNOSUPPORT", "ENETUNREACH"]);

const invalid = (message: string): WorkspaceOperationError => new WorkspaceOperationError("forward-invalid", message, 400);

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const headerPairsOf = (value: unknown): readonly HeaderPair[] => {
  if (!Array.isArray(value)) throw invalid("The headers must be a list of name and value pairs");
  return value.map((pair: unknown) => {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string" || !TOKEN.test(pair[0])) {
      throw invalid(`The header ${JSON.stringify(pair)} is not a pair of a name and a text`);
    }
    return [pair[0], pair[1]] as const;
  });
};

const requestOf = (value: unknown): ForwardedRequest | null => {
  if (value === null) return null;
  if (!isRecord(value)) throw invalid("The request must be an object or null");
  const { method, path, headers, body } = value;
  if (typeof method !== "string" || !TOKEN.test(method)) throw invalid(`${JSON.stringify(method)} is not an HTTP method`);
  if (method.toUpperCase() === "CONNECT") throw invalid("CONNECT opens a tunnel; only requests to the service are forwarded");
  if (typeof path !== "string" || !path.startsWith("/")) throw invalid(`The path ${JSON.stringify(path)} must start with /`);
  if (typeof body !== "string" || body.length % 4 !== 0 || !BASE64.test(body)) throw invalid("The body must be Base64");
  return { method, path, headers: headerPairsOf(headers), body };
};

export const forwardInputOf = (input: unknown): ForwardInput => {
  if (!isRecord(input)) throw invalid("The forwarding needs a port and a request");
  const { port, request } = input;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) throw invalid(`${JSON.stringify(port)} is not a port`);
  return { port, request: requestOf(request) };
};

/** Where the listener is reached on this machine: a wildcard on loopback, IPv4 first, a concrete address itself. */
export const forwardTargets = (addresses: readonly string[]): readonly string[] =>
  [...new Set(addresses.flatMap((address) => address === WILDCARD ? [...LOOPBACK] : [address]))];

/** The names a Connection header lists are hop-by-hop as well. */
const hopByHop = (headers: readonly HeaderPair[]): ReadonlySet<string> => new Set([
  ...HOP_BY_HOP,
  ...headers.filter(([name]) => name.toLowerCase() === "connection")
    .flatMap(([, value]) => value.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean)),
]);

const endToEnd = (headers: readonly HeaderPair[]): readonly HeaderPair[] => {
  const dropped = hopByHop(headers);
  return headers.filter(([name]) => !dropped.has(name.toLowerCase()));
};

/** The service sees the request as from its own machine: Host is localhost with its port, the length is that of the body. */
const outgoingHeaders = (request: ForwardedRequest, port: number, body: Buffer): readonly HeaderPair[] => {
  const kept = endToEnd(request.headers).filter(([name]) => !["host", "content-length"].includes(name.toLowerCase()));
  const sized = body.length > 0 || request.headers.some(([name]) => name.toLowerCase() === "content-length");
  return [["Host", `localhost:${port}`], ...kept, ...(sized ? [["Content-Length", String(body.length)] as const] : [])];
};

const pairsOf = (raw: readonly string[]): readonly HeaderPair[] =>
  Array.from({ length: raw.length / 2 }, (_, index) => [raw[index * 2]!, raw[index * 2 + 1]!] as const);

const tooLarge = (what: "request" | "response", port: number): WorkspaceOperationError => new WorkspaceOperationError(
  what === "request" ? "forward-request-too-large" : "forward-response-too-large",
  `The ${what} for port ${port} exceeds ${FORWARD_BODY_LIMIT / 1024 / 1024} MiB; forwarding carries at most that much`,
  what === "request" ? 413 : 502,
);

const responseOf = (incoming: IncomingMessage, port: number): Promise<ForwardedResponse> => new Promise((resolve, reject) => {
  const chunks: Buffer[] = [];
  let size = 0;
  incoming.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > FORWARD_BODY_LIMIT) {
      incoming.destroy();
      reject(tooLarge("response", port));
      return;
    }
    chunks.push(chunk);
  });
  incoming.on("error", reject);
  incoming.on("close", () => {
    if (!incoming.complete) reject(new Error(`The service on port ${port} closed the connection before its response was complete`));
  });
  incoming.on("end", () => {
    const status = incoming.statusCode;
    if (status === undefined) {
      reject(new Error(`The service on port ${port} answered without a status`));
      return;
    }
    resolve({ status, headers: endToEnd(pairsOf(incoming.rawHeaders)), body: Buffer.concat(chunks).toString("base64") });
  });
});

/** Node checks method, path, and headers while it builds the request; such a refusal is an invalid input, not a failed connection. */
const outgoingRequest = (address: string, port: number, request: ForwardedRequest, body: Buffer, signal: AbortSignal) => {
  try {
    return httpRequest({
      host: address,
      port,
      method: request.method,
      path: request.path,
      headers: outgoingHeaders(request, port, body).flat(),
      setHost: false,
      agent: false,
      signal,
    });
  } catch (error) {
    throw invalid(`The request cannot be sent: ${messageOf(error)}`);
  }
};

/** One attempt at one address; redirects are not followed, the connection is not kept. */
const exchange = (address: string, port: number, request: ForwardedRequest, body: Buffer, signal: AbortSignal): Promise<ForwardedResponse> =>
  new Promise((resolve, reject) => {
    const outgoing = outgoingRequest(address, port, request, body, signal);
    outgoing.on("response", (incoming) => { responseOf(incoming, port).then(resolve, reject); });
    outgoing.on("error", reject);
    outgoing.end(body);
  });

const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | undefined)?.code;

export interface ForwardOptions {
  readonly port: number;
  /** The addresses the run's processes listen on with this port, as the process table names them. */
  readonly addresses: readonly string[];
  readonly request: ForwardedRequest;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs?: number;
}

/** Calls the service on this machine; the next address only if the previous one refused the connection, so nothing was sent twice. */
export const forwardRequest = async (options: ForwardOptions): Promise<ForwardedResponse> => {
  const { port, request } = options;
  const body = Buffer.from(request.body, "base64");
  if (body.length > FORWARD_BODY_LIMIT) throw tooLarge("request", port);
  const timeoutMs = options.timeoutMs ?? FORWARD_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const targets = forwardTargets(options.addresses);
  for (const address of targets) {
    try {
      return await exchange(address, port, request, body, signal);
    } catch (error) {
      if (error instanceof WorkspaceOperationError) throw error;
      if (options.signal?.aborted) throw error;
      if (timeout.aborted) {
        throw new WorkspaceOperationError("forward-timeout", `The service on port ${port} did not answer within ${timeoutMs / 1000} s`, 504);
      }
      if (UNREACHED.has(codeOf(error) ?? "")) continue;
      throw new WorkspaceOperationError("forward-failed", `The request to port ${port} at ${address} failed: ${messageOf(error)}`, 502);
    }
  }
  throw new WorkspaceOperationError("forward-unreachable", `Nothing accepts connections on port ${port} at ${targets.join(", ")}`, 502);
};
