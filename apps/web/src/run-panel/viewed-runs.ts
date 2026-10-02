/** Reports viewed revisions per run: one request at a time, the newest revision seen meanwhile follows, nothing lower or equal goes out twice. */
export const viewedReporter = (
  send: (runId: string, revision: number) => Promise<void>,
  onError: (cause: unknown) => void,
): ((runId: string, revision: number) => void) => {
  const sent = new Map<string, number>();
  const waiting = new Map<string, number>();
  const busy = new Set<string>();
  const report = (runId: string, revision: number): void => {
    if (revision <= (sent.get(runId) ?? -1) || revision <= (waiting.get(runId) ?? -1)) return;
    if (busy.has(runId)) {
      waiting.set(runId, revision);
      return;
    }
    const previous = sent.get(runId);
    busy.add(runId);
    sent.set(runId, revision);
    void send(runId, revision).catch((cause: unknown) => {
      if (previous === undefined) sent.delete(runId);
      else sent.set(runId, previous);
      onError(cause);
    }).finally(() => {
      busy.delete(runId);
      const next = waiting.get(runId);
      waiting.delete(runId);
      if (next !== undefined) report(runId, next);
    });
  };
  return report;
};
