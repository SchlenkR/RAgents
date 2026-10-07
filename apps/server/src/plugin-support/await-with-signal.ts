export const awaitWithSignal = <T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return operation;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
};

export const sharedPreparation = <T>(work: (signal: AbortSignal) => Promise<T>) => {
  const controller = new AbortController();
  const waiters = new Set<symbol>();
  let pending = true;
  const promise = Promise.resolve().then(() => work(controller.signal)).finally(() => { pending = false; });
  return {
    promise,
    signal: controller.signal,
    async wait(signal?: AbortSignal): Promise<T> {
      signal?.throwIfAborted();
      const waiter = Symbol();
      waiters.add(waiter);
      try {
        return await awaitWithSignal(promise, signal);
      } finally {
        waiters.delete(waiter);
        if (pending && waiters.size === 0) controller.abort(new Error("The workspace preparation was cancelled."));
      }
    },
  };
};
