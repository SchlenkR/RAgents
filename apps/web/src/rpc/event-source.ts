export function fetchEventStream(url: string, signal?: AbortSignal | null): Promise<Response> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const source = new EventSource(url);
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let closed = false;
    const close = () => {
      closed = true;
      source.close();
      signal?.removeEventListener("abort", abort);
    };
    const fail = (cause: unknown) => {
      if (closed) return;
      close();
      controller.error(cause);
      reject(cause);
    };
    const abort = () => fail(signal!.reason);
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel: close });
    const receive = (event: Event) => {
      if (closed) return;
      const message = event as MessageEvent<string>;
      controller.enqueue(encoder.encode(`event: ${message.type}\ndata: ${message.data.replace(/\n/g, "\ndata: ")}\n\n`));
    };
    source.addEventListener("open", () => {
      if (!closed) resolve(new Response(body, { headers: { "content-type": "text/event-stream" } }));
    });
    source.addEventListener("error", () => fail(new Error("The event stream was closed.")));
    for (const event of ["hello", "message", "ping"]) source.addEventListener(event, receive);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
