import type { IncomingMessage, ServerResponse } from "node:http";
import { DomainError } from "@ragents/engine";

export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export class PayloadTooLargeError extends DomainError {
  constructor(maxBytes: number) {
    super("payload_too_large", `Der Request ist größer als ${maxBytes} Byte`, 413);
  }
}

export const writeJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
};

export const readBody = async (
  request: IncomingMessage,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<string> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.byteLength;
    if (size > maxBytes) throw new PayloadTooLargeError(maxBytes);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

export const readJsonBody = async <T>(
  request: IncomingMessage,
  validate: (body: unknown) => T,
  invalidJsonMessage = "Der Request enthält kein gültiges JSON",
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<T> => {
  const text = await readBody(request, maxBytes);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(invalidJsonMessage);
  }
  return validate(body);
};

export type JsonErrorMapping = { status: number; message: string };

export interface GuardedJsonRouteOptions {
  response: ServerResponse;
  request?: IncomingMessage;
  ensureSession?: () => void;
  errorStatus?: number;
  mapError?: (error: unknown) => JsonErrorMapping;
  handle: () => void | Promise<void>;
}

const defaultMapper = (status: number) => (error: unknown): JsonErrorMapping => ({
  status: error instanceof DomainError ? error.status : status,
  message: error instanceof Error ? error.message : String(error),
});

export const guardedJsonRoute = async (options: GuardedJsonRouteOptions): Promise<void> => {
  try {
    options.ensureSession?.();
    await options.handle();
  } catch (error) {
    if (options.request && (options.request.aborted || options.response.destroyed)) return;
    const mapped = (options.mapError ?? defaultMapper(options.errorStatus ?? 400))(error);
    writeJson(options.response, mapped.status, { error: mapped.message });
  }
};

export const withAbort = async <T>(
  request: IncomingMessage,
  response: ServerResponse,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const abortOnClose = () => {
    if (!response.writableEnded) controller.abort();
  };
  request.on("aborted", abort);
  response.on("close", abortOnClose);
  try {
    return await operation(controller.signal);
  } finally {
    request.off("aborted", abort);
    response.off("close", abortOnClose);
  }
};
