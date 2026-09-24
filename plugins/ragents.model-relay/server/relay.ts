import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import type { HttpRouteContribution } from "@ragents/engine";
import { PayloadTooLargeError, readBody, writeJson } from "@ragents/host/plugin-support/http.js";
import type { ModelUpstream } from "@ragents/host/plugin-support/model-upstreams.js";
import type { RelayAlias } from "./config.js";

export const RELAY_PATH_PREFIX = "/relay/v1";
export const RELAY_RIGHT = "models.use";

const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const DROPPED_HEADERS = new Set(["host", "authorization", "cookie", "content-length", "connection", "transfer-encoding", "accept-encoding", "expect"]);

export interface ResolvedAlias {
  readonly alias: string;
  readonly upstream: ModelUpstream;
  readonly model: ModelUpstream["models"][number];
}

/** Jeder Alias muss auf einen konfigurierten Anbieter und ein Modell aus dessen Katalog zeigen. */
export const resolveAliases = (aliases: readonly RelayAlias[], upstreams: readonly ModelUpstream[]): readonly ResolvedAlias[] =>
  aliases.map((entry) => {
    const upstream = upstreams.find((candidate) => candidate.id === entry.upstream);
    if (!upstream) {
      const available = upstreams.map((candidate) => candidate.id).join(", ") || "keiner";
      throw new Error(`RELAY_MODELS: der Anbieter ${entry.upstream} hinter ${entry.alias} ist auf diesem Server nicht konfiguriert (verfügbar: ${available})`);
    }
    const model = upstream.models.find((candidate) => candidate.id === entry.model);
    if (!model) throw new Error(`RELAY_MODELS: das Modell ${entry.model} hinter ${entry.alias} fehlt im Katalog von ${entry.upstream}`);
    return { alias: entry.alias, upstream, model };
  });

/** Der Katalogeintrag nennt nur, was der Verbraucher für den Draht braucht; Name, Anbieter und Kosten bleiben beim Server. */
export const catalogEntryOf = (resolved: ResolvedAlias) => ({
  id: resolved.alias,
  object: "model" as const,
  owned_by: "relay",
  catalog: {
    reasoning: resolved.model.reasoning,
    ...(resolved.model.thinkingLevelMap ? { thinkingLevelMap: resolved.model.thinkingLevelMap } : {}),
    input: [...resolved.model.input],
    contextWindow: resolved.model.contextWindow,
    maxTokens: resolved.model.maxTokens,
    ...(resolved.model.compat ? { compat: resolved.model.compat } : {}),
  },
});

interface Usage {
  readonly prompt: number | undefined;
  readonly completion: number | undefined;
}

/** Ersetzt im durchgereichten Strom den echten Modellnamen durch den Alias, entfernt den Anbieter und merkt sich den letzten usage-Block. */
const responseRewriter = (alias: string) => {
  const decoder = new TextDecoder();
  let pending = "";
  let usage: Usage | undefined;
  let overflow = false;
  const rewrite = (text: string): string => {
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { return text; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return text;
    const body = parsed as { model?: unknown; provider?: unknown; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
    if (body.usage && typeof body.usage === "object") {
      const number = (value: unknown) => typeof value === "number" ? value : undefined;
      usage = { prompt: number(body.usage.prompt_tokens), completion: number(body.usage.completion_tokens) };
    }
    if (typeof body.model !== "string" && body.provider === undefined) return text;
    const rest = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "provider"));
    return JSON.stringify(typeof body.model === "string" ? { ...rest, model: alias } : rest);
  };
  const line = (text: string): string => text.startsWith("data: ") ? `data: ${rewrite(text.slice(6))}` : text;
  return {
    feed: (chunk: Buffer): string => {
      const text = decoder.decode(chunk, { stream: true });
      if (overflow) return text;
      pending += text;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      const forwarded = lines.map((entry) => `${line(entry)}\n`).join("");
      if (pending.length <= MAX_SCAN_BYTES) return forwarded;
      overflow = true;
      const remainder = pending;
      pending = "";
      return `${forwarded}${remainder}`;
    },
    finish: (): string => {
      const rest = overflow || !pending.trim() ? pending : pending.startsWith("data: ") ? line(pending) : rewrite(pending);
      pending = "";
      return rest;
    },
    usage: (): Usage | undefined => usage,
  };
};

const openAiError = (message: string, type: string) => ({ error: { message, type } });

const forwardedHeaders = (request: IncomingMessage, apiKey: string): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (DROPPED_HEADERS.has(name) || value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  headers["content-type"] = "application/json";
  headers.authorization = `Bearer ${apiKey}`;
  return headers;
};

export interface RelayRouteOptions {
  aliases: () => readonly ResolvedAlias[];
  log: (line: string) => void;
  fetch?: typeof fetch;
}

const modelsPath = `${RELAY_PATH_PREFIX}/models`;
const completionsPath = `${RELAY_PATH_PREFIX}/chat/completions`;

export const createRelayRoutes = (options: RelayRouteOptions): HttpRouteContribution[] => {
  const fetchImpl = options.fetch ?? fetch;
  return [
    {
      id: "ragents.model-relay.models",
      isApiPath: (pathname) => pathname.startsWith(`${RELAY_PATH_PREFIX}/`),
      matches: (request, url) => request.method === "GET" && url.pathname === modelsPath,
      requiredRights: [RELAY_RIGHT],
      handle: ({ response }) => {
        writeJson(response, 200, { object: "list", data: options.aliases().map(catalogEntryOf) });
      },
    },
    {
      id: "ragents.model-relay.completions",
      isApiPath: (pathname) => pathname.startsWith(`${RELAY_PATH_PREFIX}/`),
      matches: (request, url) => request.method === "POST" && url.pathname === completionsPath,
      requiredRights: [RELAY_RIGHT],
      handle: async ({ request, response, access }) => {
        const user = access.user?.id ?? "anonym";
        let text: string;
        try {
          text = await readBody(request, MAX_REQUEST_BYTES);
        } catch (error) {
          if (!(error instanceof PayloadTooLargeError)) throw error;
          writeJson(response, 413, openAiError(error.message, "invalid_request_error"));
          return;
        }
        let parsed: unknown;
        try { parsed = JSON.parse(text); }
        catch { parsed = undefined; }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          writeJson(response, 400, openAiError("Der Anfragekörper ist kein JSON-Objekt", "invalid_request_error"));
          return;
        }
        const alias = (parsed as { model?: unknown }).model;
        if (typeof alias !== "string" || !alias) {
          writeJson(response, 400, openAiError("Die Anfrage nennt kein Modell", "invalid_request_error"));
          return;
        }
        const resolved = options.aliases().find((candidate) => candidate.alias === alias);
        if (!resolved) {
          writeJson(response, 404, openAiError(`Das Modell ${alias} ist auf diesem Relay unbekannt`, "invalid_request_error"));
          return;
        }
        const controller = new AbortController();
        response.once("close", () => controller.abort());
        const target = `${resolved.upstream.baseUrl}/chat/completions`;
        let upstream: Response;
        try {
          upstream = await fetchImpl(target, {
            method: "POST",
            headers: forwardedHeaders(request, resolved.upstream.apiKey),
            body: JSON.stringify({ ...parsed, model: resolved.model.id }),
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          const reason = error instanceof Error ? error.message : String(error);
          options.log(`${user} ${alias} -> ${resolved.upstream.id}/${resolved.model.id}: nicht erreichbar (${reason})`);
          writeJson(response, 502, openAiError(`Der Anbieter hinter ${alias} ist nicht erreichbar`, "server_error"));
          return;
        }
        response.writeHead(upstream.status, {
          "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
          "Cache-Control": "no-store",
        });
        const rewriter = responseRewriter(alias);
        if (upstream.body) {
          const source = Readable.fromWeb(upstream.body as ReadableStream<Uint8Array>);
          try {
            await pipeline(source, async function* (chunks: AsyncIterable<Buffer>) {
              for await (const chunk of chunks) {
                const forwarded = rewriter.feed(chunk);
                if (forwarded) yield forwarded;
              }
              const rest = rewriter.finish();
              if (rest) yield rest;
            }, response);
          } catch (error) {
            if (!controller.signal.aborted) throw error;
          }
        } else {
          response.end();
        }
        const usage = rewriter.usage();
        const tokens = usage ? ` tokens in=${usage.prompt ?? "?"} out=${usage.completion ?? "?"}` : "";
        options.log(`${user} ${alias} -> ${resolved.upstream.id}/${resolved.model.id}: ${upstream.status}${tokens}`);
      },
    },
  ];
};
