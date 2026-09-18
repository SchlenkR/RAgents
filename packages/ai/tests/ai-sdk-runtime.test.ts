import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { stream, streamSimple } from "../src/api/ai-sdk.ts";
import type { AssistantMessageEvent, Context, Model } from "../src/types.ts";

const model: Model<"openai-completions"> = {
	id: "test/runtime",
	name: "Runtime test",
	api: "openai-completions",
	provider: "openrouter",
	baseUrl: "https://example.invalid/api/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 2, output: 4, cacheRead: 1, cacheWrite: 3 },
	contextWindow: 128000,
	maxTokens: 1024,
};

const context: Context = {
	messages: [{ role: "user", content: "Hallo", timestamp: 1 }],
	tools: [{ name: "echo", description: "Echo", parameters: Type.Object({ text: Type.String() }) }],
};

test("SDK requests retain routing, mapped effort, cache boundaries and context limits", async (t) => {
	const requests: Array<{ body: Record<string, any>; headers: Headers }> = [];
	t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
		requests.push({ body: JSON.parse(String(init.body)), headers: new Headers(init.headers) });
		return response([chunk({ content: "Hallo" }, "stop")]);
	});
	const routedModel: Model<"openai-completions"> = {
		...model,
		id: "anthropic/test",
		contextWindow: 5000,
		thinkingLevelMap: { high: "medium", off: "none" },
		compat: { openRouterRouting: { sort: "latency", allow_fallbacks: false } },
	};
	for (const cacheRetention of ["long", "none"] as const) {
		const result = await streamSimple(routedModel, { ...context, systemPrompt: "Systemregeln" }, {
			apiKey: "test-only",
			reasoning: "high",
			cacheRetention,
			sessionId: "private-session",
			maxTokens: 2000,
		}).result();
		assert.equal(result.errorMessage, undefined);
	}
	const cached = requests[0]!;
	const cacheControl = { type: "ephemeral", ttl: "1h" };
	assert.deepEqual(cached.body.provider, { sort: "latency", allow_fallbacks: false });
	assert.deepEqual(cached.body.reasoning, { effort: "medium" });
	assert.deepEqual(cached.body.messages[0].content[0].cache_control, cacheControl);
	assert.deepEqual(cached.body.messages[1].content[0].cache_control, cacheControl);
	assert.deepEqual(cached.body.tools.at(-1).cache_control, cacheControl);
	assert.equal(cached.headers.get("x-session-id"), "private-session");
	assert.ok(cached.body.max_tokens > 0 && cached.body.max_tokens < 904);
	assert.equal(JSON.stringify(requests[1]!.body).includes("cache_control"), false);
	assert.equal(requests[1]!.headers.has("x-session-id"), false);
});

function chunk(delta: unknown, finishReason: string | null = null) {
	return {
		id: "actual-response",
		object: "chat.completion.chunk",
		created: 1,
		model: "actual/provider-model",
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	};
}

function response(chunks: unknown[]) {
	const body = chunks.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n";
	return new Response(body, { headers: { "content-type": "text/event-stream", "x-request-id": "request-1" } });
}

async function collect(source: ReturnType<typeof stream>) {
	const events: AssistantMessageEvent[] = [];
	for await (const event of source) events.push(structuredClone(event));
	return { events, result: await source.result() };
}

test("text, thinking and parallel tools retain their indices and balanced event lifecycles", async (t) => {
	t.mock.method(globalThis, "fetch", async () => response([
		chunk({ reasoning: "Prüfe " }),
		chunk({ reasoning: "beide." }),
		chunk({ content: "Ich " }),
		chunk({ content: "prüfe." }),
		chunk({ tool_calls: [{ index: 0, id: "call-a", type: "function", function: { name: "echo", arguments: "{" } }] }),
		chunk({ tool_calls: [{ index: 1, id: "call-b", type: "function", function: { name: "echo", arguments: "{" } }] }),
		chunk({ tool_calls: [{ index: 1, function: { arguments: '"text":"B"}' } }] }),
		chunk({ tool_calls: [{ index: 0, function: { arguments: '"text":"A"}' } }] }),
		chunk({}, "tool_calls"),
	]));
	const { events, result } = await collect(stream(model, context, { apiKey: "test-only" }));
	assert.equal(result.errorMessage, undefined);
	assert.equal(result.stopReason, "toolUse");
	assert.equal(events[0]?.type, "start");
	assert.equal(events.at(-1)?.type, "done");
	assert.deepEqual(result.content.map((part) => part.type), ["thinking", "text", "toolCall", "toolCall"]);
	assert.deepEqual(result.content.filter((part) => part.type === "toolCall").map((part) => [part.id, part.arguments]), [
		["call-a", { text: "A" }],
		["call-b", { text: "B" }],
	]);
	for (const [contentIndex, prefix] of ["thinking", "text", "toolcall", "toolcall"].entries()) {
		const blockEvents = events.filter((event) => "contentIndex" in event && event.contentIndex === contentIndex);
		assert.equal(blockEvents[0]?.type, `${prefix}_start`);
		assert.equal(blockEvents.at(-1)?.type, `${prefix}_end`);
		assert.equal(blockEvents.filter((event) => event.type === `${prefix}_start`).length, 1);
		assert.equal(blockEvents.filter((event) => event.type === `${prefix}_end`).length, 1);
		assert.ok(blockEvents.slice(1, -1).every((event) => event.type === `${prefix}_delta`));
		for (const event of blockEvents) {
			assert.ok("partial" in event);
			assert.equal(event.partial.content[contentIndex]?.type, result.content[contentIndex]?.type);
		}
	}
	assert.deepEqual(events.filter((event) => event.type === "thinking_delta").map((event) => event.delta), ["Prüfe ", "beide."]);
	assert.deepEqual(events.filter((event) => event.type === "text_delta").map((event) => event.delta), ["Ich ", "prüfe."]);
	assert.ok(events.findIndex((event) => event.type === "thinking_end") < events.findIndex((event) => event.type === "text_start"));
});

for (const encryptedOnly of [false, true]) {
	test(`reasoning details survive a follow-up prompt (${encryptedOnly ? "encrypted only" : "signed text and encrypted"})`, async (t) => {
		const details = [
			...(!encryptedOnly ? [{ type: "reasoning.text", text: "Prüfung", signature: "signed-thought", format: "anthropic-claude-v1", index: 0 }] : []),
			{ type: "reasoning.encrypted", data: "opaque-encrypted-state", id: "reasoning-id", format: "openai-responses-v1", index: 1 },
		];
		const requests: Array<{ messages: Array<{ role: string; reasoning_details?: unknown }> }> = [];
		t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
			requests.push(JSON.parse(String(init.body)));
			return response(requests.length === 1 ? [
				chunk({ reasoning_details: details }),
				chunk({ content: "Ergebnis" }),
				chunk({}, "stop"),
			] : [chunk({ content: "Fortsetzung" }, "stop")]);
		});
		const first = await stream(model, context, { apiKey: "test-only" }).result();
		assert.equal(first.errorMessage, undefined);
		const thinking = first.content.find((part) => part.type === "thinking");
		assert.ok(thinking);
		assert.deepEqual(JSON.parse(thinking.thinkingSignature!), details);
		if (encryptedOnly) {
			assert.equal(thinking.redacted, true);
			assert.equal(thinking.thinking, "");
		}
		const second = await stream(model, {
			messages: [...context.messages, first, { role: "user", content: "Weiter", timestamp: 2 }],
		}, { apiKey: "test-only" }).result();
		assert.equal(second.errorMessage, undefined);
		assert.equal(requests.length, 2);
		assert.deepEqual(requests[1]?.messages.find((message) => message.role === "assistant")?.reasoning_details, details);
	});
}

test("usage includes cache and reasoning tokens and preserves actual response identity", async (t) => {
	t.mock.method(globalThis, "fetch", async () => response([
		chunk({ content: "Ergebnis" }, "length"),
		{ ...chunk({}), choices: [], usage: {
			prompt_tokens: 100,
			completion_tokens: 30,
			total_tokens: 130,
			prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
			completion_tokens_details: { reasoning_tokens: 12 },
		} },
	]));
	const result = await streamSimple(model, context, { apiKey: "test-only", reasoning: "high" }).result();
	assert.equal(result.errorMessage, undefined);
	assert.equal(result.stopReason, "length");
	assert.equal(result.model, model.id);
	assert.equal(result.responseId, "actual-response");
	assert.equal(result.responseModel, "actual/provider-model");
	assert.deepEqual({ ...result.usage, cost: undefined }, {
		input: 70,
		output: 30,
		cacheRead: 20,
		cacheWrite: 10,
		reasoning: 12,
		totalTokens: 130,
		cost: undefined,
	});
	assert.ok(Math.abs(result.usage.cost.input - 70 * 2 / 1_000_000) < 1e-12);
	assert.ok(Math.abs(result.usage.cost.output - 30 * 4 / 1_000_000) < 1e-12);
	assert.ok(Math.abs(result.usage.cost.cacheRead - 20 / 1_000_000) < 1e-12);
	assert.ok(Math.abs(result.usage.cost.cacheWrite - 10 * 3 / 1_000_000) < 1e-12);
});

for (const field of ["reasoning_content", "reasoning_text"]) {
	test(`${field} remains visible thinking when an upstream provider uses the alias`, async (t) => {
		t.mock.method(globalThis, "fetch", async () => response([
			chunk({ [field]: "Prüfung " }),
			chunk({ [field]: "abgeschlossen" }),
			chunk({ content: "Ergebnis" }, "stop"),
		]));
		const { events, result } = await collect(stream(model, context, { apiKey: "test-only" }));
		assert.equal(result.errorMessage, undefined);
		assert.equal(result.content.find((part) => part.type === "thinking")?.thinking, "Prüfung abgeschlossen");
		assert.deepEqual(events.filter((event) => event.type === "thinking_delta").map((event) => event.delta), ["Prüfung ", "abgeschlossen"]);
	});
}

for (const finishReason of [null, "unexpected", "content_filter"]) {
	test(`invalid finish reason ${String(finishReason)} produces exactly one error terminal`, async (t) => {
		t.mock.method(globalThis, "fetch", async () => response([chunk({ content: "Partial" }, finishReason)]));
		const { events, result } = await collect(stream(model, context, { apiKey: "test-only" }));
		assert.equal(result.stopReason, "error");
		assert.match(result.errorMessage ?? "", /finish.reason|finish reason/i);
		assert.deepEqual(events.filter((event) => event.type === "error" || event.type === "done").map((event) => event.type), ["error"]);
		assert.deepEqual(result.content.find((part) => part.type === "text"), { type: "text", text: "Partial" });
	});
}

test("payload and response hooks finish before their next stage and null removes inherited headers", async (t) => {
	const order: string[] = [];
	t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
		order.push("fetch");
		const headers = new Headers(init.headers);
		assert.equal(headers.get("x-remove"), null);
		assert.equal(headers.get("x-keep"), "kept");
		assert.equal(headers.get("authorization"), null);
		assert.equal(JSON.parse(String(init.body)).temperature, 0.25);
		return response([chunk({ content: "Hallo" }, "stop")]);
	});
	const source = stream({ ...model, headers: { "X-Remove": "old", "X-Keep": "kept" } }, context, {
		apiKey: "test-only",
		headers: { "x-remove": null, authorization: null },
		onPayload: async (payload, target) => {
			assert.equal(target.id, model.id);
			order.push("payload-start");
			await Promise.resolve();
			order.push("payload-end");
			return { ...payload as object, temperature: 0.25 };
		},
		onResponse: async (metadata, target) => {
			assert.equal(target.id, model.id);
			assert.equal(metadata.status, 200);
			assert.equal(metadata.headers["x-request-id"], "request-1");
			order.push("response-start");
			await Promise.resolve();
			order.push("response-end");
		},
	});
	for await (const event of source) if (event.type === "text_delta") order.push("delta");
	assert.equal((await source.result()).errorMessage, undefined);
	assert.deepEqual(order, ["payload-start", "payload-end", "fetch", "response-start", "response-end", "delta"]);
});

test("HTTP failures retain their response body and do not retry by default", async (t) => {
	let requests = 0;
	const statuses: number[] = [];
	t.mock.method(globalThis, "fetch", async () => {
		requests += 1;
		return new Response("upstream capacity exhausted: diagnostic-123", { status: 503 });
	});
	const { events, result } = await collect(stream(model, context, {
		apiKey: "test-only",
		onResponse: (metadata) => { statuses.push(metadata.status); },
	}));
	assert.equal(requests, 1);
	assert.deepEqual(statuses, [503]);
	assert.equal(result.stopReason, "error");
	assert.match(result.errorMessage ?? "", /upstream capacity exhausted: diagnostic-123/);
	assert.equal(events.at(-1)?.type, "error");
});

test("a single tool chunk retains repairable JSON arguments", async (t) => {
	t.mock.method(globalThis, "fetch", async () => response([
		chunk({ tool_calls: [{ index: 0, id: "call-repair", type: "function", function: { name: "echo", arguments: '{"text":"Hallo"' } }] }),
		chunk({}, "tool_calls"),
	]));
	const { events, result } = await collect(stream(model, context, { apiKey: "test-only" }));
	assert.equal(result.errorMessage, undefined);
	assert.equal(result.stopReason, "toolUse");
	assert.deepEqual(result.content.find((part) => part.type === "toolCall")?.arguments, { text: "Hallo" });
	const ended = events.find((event) => event.type === "toolcall_end");
	assert.ok(ended?.type === "toolcall_end");
	assert.deepEqual(ended.toolCall.arguments, { text: "Hallo" });
});

test("a complete tool call followed by DONE without finish_reason remains a failed stream", async (t) => {
	t.mock.method(globalThis, "fetch", async () => response([
		chunk({ tool_calls: [{ index: 0, id: "call-unfinished", type: "function", function: { name: "echo", arguments: '{"text":"Hallo"}' } }] }),
	]));
	const { events, result } = await collect(stream(model, context, { apiKey: "test-only" }));
	assert.equal(result.stopReason, "error");
	assert.match(result.errorMessage ?? "", /finish.reason|finish reason/i);
	assert.deepEqual(events.filter((event) => event.type === "done" || event.type === "error").map((event) => event.type), ["error"]);
});

test("aborting an active response retains streamed text and terminates once", { timeout: 2000 }, async (t) => {
	const controller = new AbortController();
	let requests = 0;
	t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
		requests += 1;
		return new Response(new ReadableStream({
			start(body) {
				body.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk({ content: "Partial" }))}\n\n`));
				init.signal?.addEventListener("abort", () => body.error(init.signal?.reason), { once: true });
			},
		}), { headers: { "content-type": "text/event-stream" } });
	});
	const source = stream(model, context, { apiKey: "test-only", signal: controller.signal });
	const terminals: string[] = [];
	for await (const event of source) {
		if (event.type === "text_delta") controller.abort();
		if (event.type === "error" || event.type === "done") terminals.push(event.type);
	}
	const result = await source.result();
	assert.equal(requests, 1);
	assert.equal(result.stopReason, "aborted");
	assert.deepEqual(result.content.find((part) => part.type === "text"), { type: "text", text: "Partial" });
	assert.deepEqual(terminals, ["error"]);
});

for (const abort of [false, true]) {
	test(`${abort ? "caller abort" : "timeout"} cancels an unfinished request without retries`, { timeout: 2000 }, async (t) => {
		const controller = new AbortController();
		let requests = 0;
		let requestAborted = false;
		t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
			requests += 1;
			return new Promise<Response>((_resolve, reject) => {
				const cancel = () => {
					requestAborted = true;
					reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError"));
				};
				if (init.signal?.aborted) cancel();
				else init.signal?.addEventListener("abort", cancel, { once: true });
				if (abort) controller.abort();
			});
		});
		const keepAlive = setTimeout(() => {}, 1500);
		try {
			const { events, result } = await collect(streamSimple(model, context, {
				apiKey: "test-only",
				signal: controller.signal,
				timeoutMs: abort ? undefined : 20,
			}));
			assert.equal(requests, 1);
			assert.equal(requestAborted, true);
			assert.equal(result.stopReason, abort ? "aborted" : "error");
			assert.ok(result.errorMessage);
			assert.deepEqual(events.filter((event) => event.type === "error" || event.type === "done").map((event) => event.type), ["error"]);
		} finally {
			clearTimeout(keepAlive);
		}
	});
}
