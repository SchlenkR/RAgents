import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Type } from "typebox";
import { stream, streamSimple } from "../src/api/ai-sdk.ts";
import { isContextOverflow } from "../src/utils/overflow.ts";
import { isRetryableAssistantError } from "../src/utils/retry.ts";
import type { AssistantMessage, AssistantMessageEvent, Context, Model } from "../src/types.ts";

const mistral: Model<"openai-completions"> = {
	id: "zai-glm-5-3",
	name: "zai-glm-5-3",
	api: "openai-completions",
	provider: "example-mistral",
	baseUrl: "https://api.mistral.ai/v1",
	sdk: "mistral",
	reasoning: true,
	thinkingLevelMap: { minimal: null, medium: null, low: "low", high: "high", max: "max" },
	input: ["text"],
	cost: { input: 1.4, output: 4.4, cacheRead: 0.14, cacheWrite: 0 },
	contextWindow: 1_048_576,
	maxTokens: 131_072,
};

const compatible: Model<"openai-completions"> = {
	...mistral,
	id: "example-model",
	name: "example-model",
	provider: "example-local",
	baseUrl: "http://localhost:8000/v1",
	sdk: "openai-compatible",
	thinkingLevelMap: { xhigh: "xhigh" },
	cost: { input: 2, output: 4, cacheRead: 1, cacheWrite: 3 },
	contextWindow: 131_072,
	maxTokens: 16_384,
};

const context: Context = {
	systemPrompt: "Be brief.",
	messages: [{ role: "user", content: "Echo", timestamp: 1 }],
	tools: [{ name: "echo", description: "Echo", parameters: Type.Object({ text: Type.String() }) }],
};

const history: Context = {
	messages: [
		{ role: "user", content: "Hello", timestamp: 1 },
		{ role: "assistant", content: [{ type: "thinking", thinking: "Earlier thought" }, { type: "text", text: "Hi" }],
			api: "openai-completions", provider: compatible.provider, model: compatible.id, stopReason: "stop", timestamp: 2,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
		{ role: "assistant", content: [{ type: "text", text: "Plain" }],
			api: "openai-completions", provider: compatible.provider, model: compatible.id, stopReason: "stop", timestamp: 3,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
		{ role: "user", content: "Again", timestamp: 4 },
	],
};

const sse = (chunks: unknown[]) => new Response(chunks.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n", {
	headers: { "content-type": "text/event-stream" },
});

const mistralChunk = (delta: unknown, finishReason: string | null = null, usage?: unknown) => ({
	id: "mistral-response", object: "chat.completion.chunk", created: 1, model: "zai-glm-5-3",
	choices: [{ index: 0, delta, finish_reason: finishReason }], ...(usage ? { usage } : {}),
});

const compatibleChunk = (delta: unknown, finishReason: string | null = null) => ({
	id: "compatible-response", object: "chat.completion.chunk", created: 1, model: "example-model",
	choices: [{ index: 0, delta, finish_reason: finishReason }],
});

interface Captured {
	url: string;
	headers: Headers;
	body: Record<string, any>;
}

const capture = (t: TestContext, reply: () => Response): Captured[] => {
	const requests: Captured[] = [];
	t.mock.method(globalThis, "fetch", async (input: unknown, init: RequestInit) => {
		requests.push({ url: String(input), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
		return reply();
	});
	return requests;
};

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

const OPENROUTER_FIELDS = ["reasoning", "usage", "provider", "plugins", "stream_options", "chat_template_kwargs"];

test("Mistral gets the mapped effort as reasoning_effort, its prompt cache key and no OpenRouter fields", async (t) => {
	const requests = capture(t, () => sse([mistralChunk({ role: "assistant", content: "ok" }, "stop")]));
	for (const reasoning of ["low", "high", "max"] as const) {
		const result = await streamSimple(mistral, context, { apiKey: "test-only", reasoning, sessionId: "session-1" }).result();
		assert.equal(result.errorMessage, undefined);
	}
	await streamSimple(mistral, context, { apiKey: "test-only", sessionId: "session-1", cacheRetention: "none" }).result();
	await streamSimple({ ...mistral, thinkingLevelMap: { ...mistral.thinkingLevelMap, off: "none" } }, context, { apiKey: "test-only" }).result();
	await streamSimple({ ...mistral, reasoning: false, thinkingLevelMap: undefined }, context, { apiKey: "test-only", reasoning: "high" }).result();
	assert.deepEqual(requests.map((request) => request.body.reasoning_effort), ["low", "high", "max", undefined, "none", undefined]);
	assert.deepEqual(requests.map((request) => request.body.prompt_cache_key), ["session-1", "session-1", "session-1", undefined, undefined, undefined]);
	for (const request of requests) {
		assert.equal(request.url, "https://api.mistral.ai/v1/chat/completions");
		assert.equal(request.headers.get("authorization"), "Bearer test-only");
		assert.equal(request.headers.has("x-session-id"), false);
		assert.equal(request.body.model, "zai-glm-5-3");
		assert.equal(request.body.stream, true);
		assert.deepEqual(OPENROUTER_FIELDS.filter((field) => field in request.body), []);
		assert.equal(JSON.stringify(request.body).includes("cache_control"), false);
		assert.deepEqual(request.body.messages[0], { role: "system", content: "Be brief." });
		assert.equal(request.body.tools[0].function.name, "echo");
	}
});

test("Mistral streams thinking, text and a tool call and maps cached and reasoning tokens to usage and cost", async (t) => {
	for (const cached of [{ num_cached_tokens: 800 }, { prompt_tokens_details: { cached_tokens: 800 } }]) {
		capture(t, () => sse([
			mistralChunk({ role: "assistant", content: [{ type: "thinking", thinking: [{ type: "text", text: "Check " }] }] }),
			mistralChunk({ content: [{ type: "thinking", thinking: [{ type: "text", text: "the input." }] }] }),
			mistralChunk({ content: "Calling." }),
			mistralChunk({ content: "", tool_calls: [{ id: "call1abcd", index: 0, function: { name: "echo", arguments: '{"text":"Grüße"}' } }] }, "tool_calls", {
				prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050, ...cached, completion_tokens_details: { reasoning_tokens: 20 },
			}),
		]));
		const source = stream(mistral, context, { apiKey: "test-only" });
		const events: AssistantMessageEvent[] = [];
		for await (const event of source) events.push(event);
		const result = await source.result();
		assert.equal(result.errorMessage, undefined);
		assert.equal(result.stopReason, "toolUse");
		assert.equal(result.responseId, "mistral-response");
		assert.deepEqual(result.content, [
			{ type: "thinking", thinking: "Check the input." },
			{ type: "text", text: "Calling." },
			{ type: "toolCall", id: "call1abcd", name: "echo", arguments: { text: "Grüße" } },
		]);
		assert.deepEqual(events.filter((event) => event.type === "thinking_delta").map((event) => event.delta), ["Check ", "the input."]);
		assert.deepEqual(events.map((event) => event.type).filter((type) => type === "done" || type === "error"), ["done"]);
		assert.deepEqual({ ...result.usage, cost: undefined }, { input: 200, output: 50, cacheRead: 800, cacheWrite: 0, reasoning: 20, totalTokens: 1050, cost: undefined });
		near(result.usage.cost.input, 200 * 1.4 / 1_000_000);
		near(result.usage.cost.cacheRead, 800 * 0.14 / 1_000_000);
		near(result.usage.cost.output, 50 * 4.4 / 1_000_000);
		near(result.usage.cost.total, (200 * 1.4 + 800 * 0.14 + 50 * 4.4) / 1_000_000);
		t.mock.restoreAll();
	}
});

test("Mistral replays earlier thinking as thinking content of the assistant message", async (t) => {
	const requests = capture(t, () => sse([mistralChunk({ content: "ok" }, "stop")]));
	const replay = { messages: history.messages.map((message) => message.role === "assistant" ? { ...message, provider: mistral.provider, model: mistral.id } : message) };
	assert.equal((await stream(mistral, replay, { apiKey: "test-only" }).result()).errorMessage, undefined);
	const assistants = requests[0]!.body.messages.filter((message: { role: string }) => message.role === "assistant");
	assert.deepEqual(assistants[0].content, [
		{ type: "thinking", thinking: [{ type: "text", text: "Earlier thought" }], closed: true },
		{ type: "text", text: "Hi" },
	]);
	assert.equal(assistants[1].content, "Plain");
	assert.equal("reasoning_content" in assistants[0], false);
});

test("a rejected Mistral request keeps status and body, is not retried, and an overflow is recognized", async (t) => {
	let reply = { status: 422, body: JSON.stringify({ detail: [{ type: "extra_forbidden", loc: ["body", "reasoning"], msg: "Extra inputs are not permitted" }] }) };
	let requests = 0;
	t.mock.method(globalThis, "fetch", async () => {
		requests += 1;
		return new Response(reply.body, { status: reply.status, headers: { "content-type": "application/json" } });
	});
	const rejected = await stream(mistral, context, { apiKey: "test-only" }).result();
	assert.equal(requests, 1);
	assert.equal(rejected.stopReason, "error");
	assert.match(rejected.errorMessage ?? "", /^422: .*extra_forbidden/);
	assert.equal(isRetryableAssistantError(rejected), false);
	reply = { status: 400, body: JSON.stringify({ object: "error", type: "invalid_request_error", param: null, code: "3051",
		message: "Prompt contains 1100000 tokens and 0 draft tokens, too large for model with 1048576 maximum context length" }) };
	const overflow = await stream(mistral, context, { apiKey: "test-only" }).result();
	assert.equal(overflow.stopReason, "error");
	assert.equal(isContextOverflow(overflow, mistral.contextWindow), true);
});

test("openai-compatible sends the mapped effort as reasoning_effort, asks for usage and no OpenRouter fields", async (t) => {
	const requests = capture(t, () => sse([compatibleChunk({ content: "ok" }, "stop")]));
	for (const reasoning of ["low", "xhigh", undefined] as const) {
		const result = await streamSimple(compatible, context, { apiKey: "test-only", reasoning, sessionId: "session-1" }).result();
		assert.equal(result.errorMessage, undefined);
	}
	await streamSimple({ ...compatible, thinkingLevelMap: { off: "none" } }, context, { apiKey: "test-only" }).result();
	assert.deepEqual(requests.map((request) => request.body.reasoning_effort), ["low", "xhigh", undefined, "none"]);
	for (const request of requests) {
		assert.equal(request.url, "http://localhost:8000/v1/chat/completions");
		assert.equal(request.headers.get("authorization"), "Bearer test-only");
		assert.deepEqual(request.body.stream_options, { include_usage: true });
		assert.deepEqual(["reasoning", "usage", "provider", "plugins", "chat_template_kwargs"].filter((field) => field in request.body), []);
		assert.equal(request.headers.has("x-session-id"), false);
	}
});

test("openai-compatible with qwen-chat-template switches thinking through chat_template_kwargs as before", async (t) => {
	const qwen: Model<"openai-completions"> = { ...compatible, compat: { thinkingFormat: "qwen-chat-template" } };
	const requests = capture(t, () => sse([compatibleChunk({ content: "ok" }, "stop")]));
	for (const reasoning of ["off", "low", "xhigh"] as const) {
		assert.equal((await streamSimple(qwen, history, { apiKey: "test-only", reasoning }).result()).errorMessage, undefined);
	}
	await streamSimple({ ...qwen, reasoning: false, thinkingLevelMap: undefined }, history, { apiKey: "test-only", reasoning: "high" }).result();
	assert.deepEqual(requests.map((request) => [request.body.chat_template_kwargs, request.body.reasoning_effort, "reasoning" in request.body]), [
		[{ enable_thinking: false, preserve_thinking: true }, undefined, false],
		[{ enable_thinking: true, preserve_thinking: true }, "low", false],
		[{ enable_thinking: true, preserve_thinking: true }, "xhigh", false],
		[{ enable_thinking: false, preserve_thinking: true }, undefined, false],
	]);
	const assistant = requests[1]!.body.messages.find((message: { role: string }) => message.role === "assistant");
	assert.equal(assistant.reasoning_content, "Earlier thought");
	assert.deepEqual(["reasoning", "reasoning_details"].filter((field) => field in assistant), []);
});

test("openai-compatible keeps replayed thinking and adds an empty reasoning_content where the server requires one", async (t) => {
	const requests = capture(t, () => sse([compatibleChunk({ content: "ok" }, "stop")]));
	const strict: Model<"openai-completions"> = { ...compatible, compat: { requiresReasoningContentOnAssistantMessages: true } };
	assert.equal((await stream(strict, history, { apiKey: "test-only" }).result()).errorMessage, undefined);
	const assistants = requests[0]!.body.messages.filter((message: { role: string }) => message.role === "assistant");
	assert.deepEqual(assistants.map((message: { reasoning_content?: string }) => message.reasoning_content), ["Earlier thought", ""]);
});

test("openai-compatible streams null deltas, reasoning_content and split tool calls and maps cached, written and reasoning tokens", async (t) => {
	const empty = { role: null, content: null, refusal: null, audio: null, function_call: null };
	capture(t, () => sse([
		compatibleChunk({ ...empty, role: "assistant", reasoning_content: "Check " }),
		compatibleChunk({ ...empty, reasoning_content: "the input." }),
		compatibleChunk({ ...empty, tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "echo", arguments: "" } }] }),
		compatibleChunk({ ...empty, tool_calls: [{ index: 0, type: null, function: { name: null, arguments: '{"text":' } }] }),
		compatibleChunk({ ...empty, tool_calls: [{ index: 0, function: { arguments: '"Grüße"}' } }] }),
		compatibleChunk(empty, "tool_calls"),
		{ ...compatibleChunk({}), choices: [], usage: {
			prompt_tokens: 100, completion_tokens: 30, total_tokens: 130,
			prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 12 },
		} },
	]));
	const result = await stream(compatible, context, { apiKey: "test-only" }).result();
	assert.equal(result.errorMessage, undefined);
	assert.equal(result.stopReason, "toolUse");
	assert.equal(result.responseModel, "example-model");
	assert.deepEqual(result.content, [
		{ type: "thinking", thinking: "Check the input." },
		{ type: "toolCall", id: "call-1", name: "echo", arguments: { text: "Grüße" } },
	]);
	assert.deepEqual({ ...result.usage, cost: undefined }, { input: 70, output: 30, cacheRead: 20, cacheWrite: 10, reasoning: 12, totalTokens: 130, cost: undefined });
	near(result.usage.cost.input, 70 * 2 / 1_000_000);
	near(result.usage.cost.output, 30 * 4 / 1_000_000);
	near(result.usage.cost.cacheRead, 20 / 1_000_000);
	near(result.usage.cost.cacheWrite, 10 * 3 / 1_000_000);
});

test("a model without pricing keeps cost 0 while its token counts stay complete", async (t) => {
	capture(t, () => sse([
		compatibleChunk({ content: "ok" }, "stop"),
		{ ...compatibleChunk({}), choices: [], usage: { prompt_tokens: 40, completion_tokens: 5, total_tokens: 45, prompt_tokens_details: { cached_tokens: 30 } } },
	]));
	const result = await stream({ ...compatible, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }, context, { apiKey: "test-only" }).result();
	assert.deepEqual(result.usage, {
		input: 10, output: 5, cacheRead: 30, cacheWrite: 0, reasoning: 0, totalTokens: 45,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	});
});

test("an sdk stream without a finish reason and an aborted sdk stream end with exactly one error", { timeout: 2000 }, async (t) => {
	for (const model of [mistral, compatible]) {
		const chunk = model === mistral ? mistralChunk({ content: "Partial" }) : compatibleChunk({ content: "Partial" });
		capture(t, () => sse([chunk]));
		const unfinished = stream(model, context, { apiKey: "test-only" });
		const terminals: string[] = [];
		for await (const event of unfinished) if (event.type === "done" || event.type === "error") terminals.push(event.type);
		const result = await unfinished.result();
		assert.equal(result.stopReason, "error", model.sdk);
		assert.match(result.errorMessage ?? "", /finish.reason|finish reason/i);
		assert.deepEqual(terminals, ["error"]);
		t.mock.restoreAll();
		const controller = new AbortController();
		t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => new Response(new ReadableStream({
			start(body) {
				body.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
				init.signal?.addEventListener("abort", () => body.error(init.signal?.reason), { once: true });
			},
		}), { headers: { "content-type": "text/event-stream" } }));
		const aborted = stream(model, context, { apiKey: "test-only", signal: controller.signal });
		for await (const event of aborted) if (event.type === "text_delta") controller.abort();
		const abortedResult: AssistantMessage = await aborted.result();
		assert.equal(abortedResult.stopReason, "aborted", model.sdk);
		assert.deepEqual(abortedResult.content, [{ type: "text", text: "Partial" }]);
		t.mock.restoreAll();
	}
});

test("a model naming an unknown sdk fails before any request and names the supported ones", async (t) => {
	const requests = capture(t, () => sse([]));
	const result = await stream({ ...compatible, sdk: "anthropic" as never }, context, { apiKey: "test-only" }).result();
	assert.equal(requests.length, 0);
	assert.equal(result.stopReason, "error");
	assert.match(result.errorMessage ?? "", /unknown sdk "anthropic"; supported are mistral, openai-compatible/);
});
