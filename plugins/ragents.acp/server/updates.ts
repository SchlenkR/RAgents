import type { SessionUpdate, ToolCallUpdate, ToolCallContent } from "@agentclientprotocol/sdk";
import type { JsonValue, TurnRequest } from "@ragents/engine";

interface Call {
  readonly id: string;
  readonly name: string;
  update: ToolCallUpdate;
  state: "pending" | "started" | "finished";
}

const boundedText = (text: string): string => {
  const lines = text.split("\n");
  const clipped = lines.slice(0, 80).map((line) => line.length > 1000 ? `${line.slice(0, 1000)} [Line truncated]` : line).join("\n");
  const marker = "\n[Output truncated]";
  return clipped.length > 8192 || lines.length > 80 ? `${clipped.slice(0, 8192 - marker.length)}${marker}` : clipped;
};

const contentText = (content: readonly ToolCallContent[]): string => content.map((part) =>
  part.type === "content" && part.content.type === "text" ? part.content.text
    : part.type === "diff" ? `Changed ${part.path}\n${part.newText}`
    : part.type === "terminal" ? "Terminal command" : "Attached tool content").join("\n");

export class AcpUpdates {
  readonly #request: TurnRequest<"external">;
  readonly #signal: AbortSignal;
  readonly #calls = new Map<string, Call>();
  #block: { kind: "text" | "thinking"; message: string | null; text: string } | undefined;
  #sequence = 0;
  #cost: number | undefined;

  constructor(request: TurnRequest<"external">, signal: AbortSignal) {
    this.#request = request;
    this.#signal = signal;
  }

  get cost(): number | undefined { return this.#cost; }

  accept(update: SessionUpdate): void {
    if (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "agent_thought_chunk") {
      const kind = update.sessionUpdate === "agent_message_chunk" ? "text" : "thinking";
      const message = update.messageId ?? null;
      if (this.#block && (this.#block.kind !== kind || this.#block.message !== message)) this.#flush(this.#signal.aborted);
      if (update.content.type !== "text") {
        this.#flush(this.#signal.aborted);
        this.#request.emit({ kind: "runtime", text: `External agent sent ${update.content.type} content.` });
        return;
      }
      if (!this.#block) this.#block = { kind, message, text: "" };
      this.#block.text += update.content.text;
      this.#request.publish({ kind, delta: update.content.text });
      if (this.#block.text.length >= 512 * 1024) this.#flush(this.#signal.aborted);
      return;
    }
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      this.#flush(this.#signal.aborted);
      this.#tool(update);
    } else if (update.sessionUpdate === "plan") {
      this.#flush(this.#signal.aborted);
      this.#request.emit({ kind: "runtime", text: boundedText(`Plan:\n${update.entries.map((entry) => `[${entry.status}] ${entry.content}`).join("\n") || "No pending steps."}`) });
    } else if (update.sessionUpdate === "usage_update" && update.cost) {
      if (update.cost.currency !== "USD") this.#request.emit({ kind: "runtime", text: `External agent reports costs in ${update.cost.currency}; USD turn cost is unavailable.` });
      else this.#cost = update.cost.amount;
    }
  }

  permission(update: ToolCallUpdate): void {
    this.#flush(this.#signal.aborted);
    this.#tool({ ...update, sessionUpdate: "tool_call_update" }, true);
  }

  #start(call: Call): void {
    if (call.state !== "pending") return;
    const input: JsonValue = { title: call.update.title ?? "External tool", ...(call.update.rawInput === undefined ? {} : { arguments: call.update.rawInput as JsonValue }) };
    this.#request.recordTool?.({ kind: "started", id: call.id, name: call.name, input });
    call.state = "started";
    this.#request.publish({ kind: "tool", id: call.id, name: call.name, arguments: JSON.stringify(input) });
  }

  #complete(call: Call, failed: boolean, result: string): void {
    if (failed) this.#request.recordTool?.({ kind: "failed", id: call.id, name: call.name, error: result });
    else this.#request.recordTool?.({ kind: "completed", id: call.id, name: call.name, output: { text: result } });
    call.state = "finished";
    this.#request.publish({ kind: "tool-result", id: call.id, result, isError: failed });
  }

  #tool(update: ToolCallUpdate & { sessionUpdate: string }, permission = false): void {
    const known = this.#calls.get(update.toolCallId);
    if (!known && update.sessionUpdate !== "tool_call" && !permission) throw new Error("ACP agent updated a tool call it has not announced");
    const call: Call = known ?? { id: `external_${++this.#sequence}`, name: update.name ?? `acp_${update.kind ?? "other"}`, update, state: "pending" };
    if (!known) this.#calls.set(update.toolCallId, call);
    if (call.state === "finished") return;
    call.update = { ...call.update,
      ...Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined && value !== null)),
      rawInput: update.rawInput === undefined ? call.update.rawInput : update.rawInput,
      rawOutput: update.rawOutput === undefined ? call.update.rawOutput : update.rawOutput,
    };
    if (permission || call.update.status === "in_progress" || call.update.status === "completed" || call.update.status === "failed") this.#start(call);
    if (update.status !== "completed" && update.status !== "failed") return;
    const result = boundedText(call.update.content?.length ? contentText(call.update.content)
      : call.update.rawOutput === undefined ? update.status === "completed" ? "Completed." : "External tool failed."
      : typeof call.update.rawOutput === "string" ? call.update.rawOutput : JSON.stringify(call.update.rawOutput));
    this.#complete(call, update.status === "failed", result);
  }

  finish(interrupted: boolean): void {
    this.#flush(interrupted);
    for (const call of this.#calls.values()) {
      if (call.state === "finished") continue;
      const pending = call.state === "pending";
      this.#start(call);
      if (!interrupted) this.#complete(call, true, `External agent ended the turn before ${pending ? "starting" : "completing"} this tool call.`);
    }
  }

  #flush(interrupted: boolean): void {
    const block = this.#block;
    this.#block = undefined;
    if (!block?.text.trim()) return;
    this.#request.emit({ kind: block.kind === "thinking" ? "reasoning-completed" : interrupted ? "assistant-interrupted" : "assistant-completed", text: block.text });
  }
}
