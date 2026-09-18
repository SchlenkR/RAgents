export function helpSampleRequest(event: Pick<MessageEvent, "source" | "origin" | "data">,
  frame: Window | null, origin: string, entries: readonly string[]): { type: "ready" } | { type: "start"; entry: string } | undefined {
  if (!frame || event.source !== frame || event.origin !== origin) return;
  const data: unknown = event.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  if (!("type" in data)) return;
  if (data.type === "ragents:help-ready") return { type: "ready" };
  if (data.type === "ragents:start-sample" && "entry" in data && typeof data.entry === "string" && entries.includes(data.entry)) {
    return { type: "start", entry: data.entry };
  }
}
