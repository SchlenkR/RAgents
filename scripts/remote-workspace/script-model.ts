import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** Der einzige Alias, den das Skriptmodell anbietet; das Prüfprofil nennt ihn als Modell. */
export const SCRIPT_MODEL = "script";

/** Ein Werkzeugaufruf, den das Skriptmodell in genau einem Modellschritt ausgibt. */
export interface ScriptStep {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface ScriptProgram {
  readonly id: string;
  readonly steps: readonly ScriptStep[];
}

/** Ein Auftrag, den das Skriptmodell ohne Kennzeichen am Wortlaut erkennt, etwa aus einem fremden Testläufer. */
export interface KnownTask {
  readonly marker: string;
  readonly program: ScriptProgram;
}

/** Was das Modell je Anfrage gesehen und geantwortet hat; die Prüfungen lesen daraus Systemprompt und Werkzeugangebot. */
export interface ScriptExchange {
  readonly program: string | undefined;
  readonly step: number;
  readonly systemPrompt: string;
  readonly offeredTools: readonly string[];
  readonly reply: string;
}

export interface ScriptModel {
  /** Die Adresse für RELAY_URL; das Relay hängt /relay/v1 selbst an. */
  readonly url: string;
  readonly exchanges: readonly ScriptExchange[];
  close: () => Promise<void>;
}

const DIRECTIVE = /SKRIPT:([A-Za-z0-9_-]+)/g;
const API_PATH = "/relay/v1";
const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** Hängt das Programm als Kennzeichen an einen Auftrag; das Modell führt dann genau diese Schritte aus. */
export const scriptedMessage = (text: string, program: ScriptProgram): string =>
  `${text}\n\nSKRIPT:${Buffer.from(JSON.stringify(program)).toString("base64url")}`;

interface ChatMessage {
  readonly role: string;
  readonly content?: unknown;
}

interface ChatRequest {
  readonly messages?: readonly ChatMessage[];
  readonly tools?: ReadonlyArray<{ readonly function?: { readonly name?: string } }>;
  readonly stream?: boolean;
}

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("\n");
};

const decodeProgram = (encoded: string): ScriptProgram => {
  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ScriptProgram;
  if (typeof parsed.id !== "string" || !Array.isArray(parsed.steps)) throw new Error("Das Kennzeichen SKRIPT trägt kein gültiges Programm");
  return parsed;
};

/** Das jüngste Programm des Gesprächs und wie viele seiner Schritte das Modell schon ausgegeben hat. */
const currentProgram = (messages: readonly ChatMessage[], known: readonly KnownTask[]): { program: ScriptProgram; step: number } | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "user") continue;
    const text = textOf(message.content);
    const encoded = [...text.matchAll(DIRECTIVE)].at(-1)?.[1];
    const program = encoded !== undefined ? decodeProgram(encoded) : known.find((task) => text.includes(task.marker))?.program;
    if (!program) continue;
    const step = messages.slice(index + 1).filter((later) => later.role === "assistant").length;
    return { program, step };
  }
  return undefined;
};

const readBody = (request: IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
  const chunks: Buffer[] = [];
  let size = 0;
  request.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      reject(new Error("Die Modellanfrage ist zu groß"));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  request.on("error", reject);
});

type Reply = { readonly kind: "text"; readonly text: string } | { readonly kind: "tool"; readonly id: string; readonly step: ScriptStep };

const streamReply = (response: ServerResponse, reply: Reply): void => {
  const base = { id: `chatcmpl-${randomBytes(8).toString("hex")}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: SCRIPT_MODEL };
  const send = (value: unknown): void => { response.write(`data: ${JSON.stringify(value)}\n\n`); };
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const delta = reply.kind === "text"
    ? { role: "assistant", content: reply.text }
    : { role: "assistant", tool_calls: [{ index: 0, id: reply.id, type: "function", function: { name: reply.step.tool, arguments: JSON.stringify(reply.step.input) } }] };
  send({ ...base, choices: [{ index: 0, delta, finish_reason: null }] });
  send({
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: reply.kind === "text" ? "stop" : "tool_calls" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  response.end("data: [DONE]\n\n");
};

const catalog = {
  object: "list",
  data: [{
    id: SCRIPT_MODEL,
    object: "model",
    owned_by: "relay",
    catalog: { reasoning: false, input: ["text"], contextWindow: 200_000, maxTokens: 8_192 },
  }],
};

/** Ein Modell-Relay auf 127.0.0.1, das statt eines Sprachmodells die Schritte des Auftrags ausgibt: je Anfrage einen Werkzeugaufruf, danach einen Schlusssatz. */
export const startScriptModel = async (token: string, known: readonly KnownTask[] = []): Promise<ScriptModel> => {
  const exchanges: ScriptExchange[] = [];
  const answer = (body: ChatRequest): Reply => {
    const messages = body.messages ?? [];
    const systemPrompt = messages.filter((message) => message.role === "system" || message.role === "developer").map((message) => textOf(message.content)).join("\n");
    const offeredTools = (body.tools ?? []).map((tool) => tool.function?.name).filter((name): name is string => typeof name === "string");
    const current = currentProgram(messages, known);
    const reply: Reply = (() => {
      // Ohne Werkzeuge ist es eine Nebenanfrage der Engine, etwa Skill-Auswahl oder Titel; sie bekommt eine neutrale Antwort.
      if (offeredTools.length === 0) return { kind: "text", text: systemPrompt.includes("ABSTAIN") ? "ABSTAIN" : "Prüflauf" };
      if (!current) return { kind: "text", text: "Prüflauf." };
      const step = current.program.steps[current.step];
      if (!step) return { kind: "text", text: `Skript ${current.program.id} beendet.` };
      if (!offeredTools.includes(step.tool)) {
        return { kind: "text", text: `SKRIPTFEHLER: Das Werkzeug ${step.tool} wird nicht angeboten (angeboten: ${offeredTools.join(", ") || "keines"}).` };
      }
      return { kind: "tool", id: `call_${current.program.id}_${current.step}_${randomBytes(4).toString("hex")}`, step };
    })();
    exchanges.push({
      program: current?.program.id,
      step: current?.step ?? 0,
      systemPrompt,
      offeredTools,
      reply: reply.kind === "text" ? reply.text : `${reply.step.tool} ${JSON.stringify(reply.step.input)}`,
    });
    return reply;
  };
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "Falscher Token für das Skriptmodell" } }));
        return;
      }
      if (request.method === "GET" && request.url === `${API_PATH}/models`) {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(catalog));
        return;
      }
      if (request.method === "POST" && request.url === `${API_PATH}/chat/completions`) {
        const body = JSON.parse(await readBody(request)) as ChatRequest;
        if (body.stream !== true) throw new Error("Das Skriptmodell antwortet nur gestreamt");
        streamReply(response, answer(body));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: `Unbekannt: ${request.method} ${request.url}` } }));
    })().catch((error: unknown) => {
      if (response.headersSent) response.destroy();
      else response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    exchanges,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
};
