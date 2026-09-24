import {
  CancellationTokenSource,
  createMessageConnection,
  ResponseError,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";

export { ResponseError as JsonRpcError } from "vscode-jsonrpc/node";

export const LSP_CONTENT_MODIFIED = -32801;

export interface JsonRpcConnectionOptions {
  label: string;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  onRequest: (method: string, params: unknown) => Promise<unknown>;
  onNotification: (method: string, params: unknown) => void;
  onError: (error: Error) => void;
}

export class JsonRpcConnection {
  readonly #options: JsonRpcConnectionOptions;
  readonly #connection: MessageConnection;
  #closed: Error | undefined;

  constructor(options: JsonRpcConnectionOptions) {
    this.#options = options;
    const reader = new StreamMessageReader(options.input);
    reader.partialMessageTimeout = 0;
    const writer = new StreamMessageWriter(options.output);
    this.#connection = createMessageConnection(reader, {
      onError: writer.onError,
      onClose: writer.onClose,
      // vscode-jsonrpc rethrows writer rejections from an async Promise executor.
      write: (message) => writer.write(message).catch((error: unknown) => {
        this.#fail(error instanceof Error ? error : new Error(String(error)));
      }),
      end: () => writer.end(),
      dispose: () => writer.dispose(),
    });
    this.#connection.onRequest(async (method, params) => (await options.onRequest(method, params)) ?? null);
    this.#connection.onNotification(options.onNotification);
    this.#connection.onNotification("$/progress", (params) => options.onNotification("$/progress", params));
    this.#connection.onNotification("$/logTrace", (params) => options.onNotification("$/logTrace", params));
    this.#connection.onError(([error]) => this.#fail(error));
    this.#connection.onClose(() => this.#fail(new Error("Verbindung geschlossen")));
    this.#connection.listen();
  }

  async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.#closed) throw this.#closed;
    const abortError = () => signal?.reason instanceof Error ? signal.reason : new Error(`${method} wurde abgebrochen`);
    if (signal?.aborted) throw abortError();
    const parameters = params === null || params === undefined ? [] : [params];
    const cancellation = new CancellationTokenSource();
    let onAbort: (() => void) | undefined;
    try {
      return await new Promise((resolve, reject) => {
        onAbort = () => {
          cancellation.cancel();
          reject(abortError());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        this.#connection.sendRequest(method, ...parameters, cancellation.token).then(resolve, (error: unknown) => {
          if (this.#closed) reject(this.#closed);
          else if (error instanceof ResponseError) {
            reject(new ResponseError(
              error.code,
              `${this.#options.label}: ${method} fehlgeschlagen: ${error.message}`,
              error.data,
            ));
          } else reject(error);
        });
      });
    } finally {
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      cancellation.dispose();
    }
  }

  notify(method: string, params: unknown): void {
    if (this.#closed) throw this.#closed;
    const parameters = params === null || params === undefined ? [] : [params];
    void this.#connection.sendNotification(method, ...parameters).catch((error: unknown) => {
      this.#fail(error instanceof Error ? error : new Error(String(error)));
    });
  }

  close(error: Error): void {
    if (this.#closed) return;
    this.#closed = error;
    this.#connection.dispose();
  }

  #fail(error: Error): void {
    if (this.#closed) return;
    const failure = new Error(`${this.#options.label}: JSON-RPC-Verbindung fehlgeschlagen: ${error.message}`, { cause: error });
    this.close(failure);
    this.#options.onError(failure);
  }
}
