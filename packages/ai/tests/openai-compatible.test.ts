import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Type } from "typebox";
import { stream } from "../src/api/ai-sdk.ts";
import { createSdkProvider } from "../src/api/ai-sdk-transport.ts";
import { normalizeOpenAiResponse } from "../src/api/openai-compatible-response.ts";
import type { Context, Model } from "../src/types.ts";

const model: Model<"openai-completions"> = {
	id: "example-model",
	name: "Compatible model",
	api: "openai-completions",
	provider: "custom",
	baseUrl: "https://example.invalid/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 1024,
	compat: { thinkingFormat: "qwen-chat-template" },
};

const context: Context = {
	messages: [{ role: "user", content: "Echo", timestamp: 1 }],
	tools: [{ name: "echo", description: "Echo", parameters: Type.Object({ text: Type.String() }) }],
};

function chunk(delta: unknown, finishReason: string | null = null) {
	return { id: "response", choices: [{ index: 0, delta, finish_reason: finishReason }] };
}

function response(chunks: unknown[]) {
	return new Response(chunks.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n", {
		headers: { "content-type": "text/event-stream" },
	});
}

for (const field of ["role", "content", "refusal", "audio", "function_call"]) {
	test(`upstream schema ${field === "role" ? "rejects" : "accepts"} delta.${field}: null`, async () => {
		const provider = createOpenRouter({ apiKey: "test-only", fetch: async () => response([
			chunk({ [field]: null }), chunk({ content: "Done" }, "stop"),
		]) });
		const result = await provider.chat(model.id).doStream({ prompt: [] });
		const parts = await Array.fromAsync(result.stream);
		assert.equal(parts.some((part) => part.type === "error"), field === "role");
	});
}

test("upstream rejects a null tool type and null message.tool_calls", async () => {
	const provider = createOpenRouter({ apiKey: "test-only", fetch: async (_input, init) => {
		if (JSON.parse(String(init?.body)).stream) return response([
			chunk({ tool_calls: [{ index: 0, type: null, function: { name: "echo", arguments: "{}" } }] }),
		]);
		return Response.json({ choices: [{ message: { role: "assistant", content: "Done", tool_calls: null }, finish_reason: "stop" }] });
	} });
	const streamed = await provider.chat(model.id).doStream({ prompt: [] });
	assert.ok((await Array.fromAsync(streamed.stream)).some((part) => part.type === "error"));
	await assert.rejects(provider.chat(model.id).doGenerate({ prompt: [] }), /Invalid JSON response/);
});

function toolResponse() {
	const empty = { role: null, content: null, refusal: null, audio: null, function_call: null };
	return response([
		chunk({ ...empty, reasoning_content: "Check " }),
		chunk({ ...empty, reasoning_content: "the input." }),
		chunk({ ...empty, tool_calls: [{ index: 0, id: "call-1", function: { name: "echo", arguments: "" } }] }),
		chunk({ ...empty, tool_calls: [{ index: 0, type: null, function: { name: null, arguments: '{"text":' } }] }),
		chunk({ ...empty, tool_calls: [{ index: 0, function: { arguments: '"Grüße"}' } }] }),
		chunk(empty, "tool_calls"),
	]);
}

for (const transport of ["recorded", "http"]) {
	test(`custom providers accept null deltas, split tool calls and Qwen reasoning over ${transport}`, async (t) => {
		let baseUrl = model.baseUrl;
		if (transport === "recorded") t.mock.method(globalThis, "fetch", async () => toolResponse());
		else {
			const server = createServer(async (request, reply) => {
				for await (const _chunk of request) {}
				reply.writeHead(200, { "content-type": "text/event-stream" });
				reply.end(await toolResponse().text());
			});
			try {
				server.listen(0, "127.0.0.1");
				await once(server, "listening");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
				t.skip("Sandbox does not allow a local listener");
				return;
			}
			t.after(() => new Promise<void>((resolve, reject) => {
				server.closeAllConnections();
				server.close((error) => error ? reject(error) : resolve());
			}));
			const address = server.address();
			assert.ok(address && typeof address === "object");
			baseUrl = `http://127.0.0.1:${address.port}/v1`;
		}
		const source = stream({ ...model, baseUrl }, context, { apiKey: "test-only" });
		const events = await Array.fromAsync(source);
		const result = await source.result();
		assert.equal(result.errorMessage, undefined);
		assert.equal(result.stopReason, "toolUse");
		assert.deepEqual(result.content, [
			{ type: "thinking", thinking: "Check the input." },
			{ type: "toolCall", id: "call-1", name: "echo", arguments: { text: "Grüße" } },
		]);
		assert.deepEqual(events.filter((event) => event.type === "thinking_delta").map((event) => event.delta), ["Check ", "the input."]);
		assert.deepEqual(events.filter((event) => event.type === "done" || event.type === "error").map((event) => event.type), ["done"]);
	});
}

test("JSON responses accept absent tool calls and retain reasoning_content", async (t) => {
	t.mock.method(globalThis, "fetch", async () => Response.json({
		id: "response",
		choices: [{ index: 0, message: {
			role: "assistant", content: "Done", reasoning_content: "Check the input.",
			tool_calls: null, refusal: null, audio: null, function_call: null,
		}, finish_reason: "stop" }],
	}));
	const result = await createSdkProvider(model, { apiKey: "test-only" }).chat(model.id).doGenerate({ prompt: [] });
	assert.deepEqual(result.content.map((part) => [part.type, "text" in part ? part.text : undefined]), [
		["reasoning", "Check the input."], ["text", "Done"],
	]);
});

test("JSON tool calls infer function type from null or absent type", async (t) => {
	for (const type of [null, undefined]) {
		t.mock.method(globalThis, "fetch", async () => Response.json({
			choices: [{ message: { role: "assistant", content: null,
				tool_calls: [{ id: "call-1", type, function: { name: "echo", arguments: '{"value":null}' } }],
			}, finish_reason: "tool_calls" }],
		}));
		const result = await createSdkProvider(model, { apiKey: "test-only" }).chat(model.id).doGenerate({ prompt: [] });
		assert.deepEqual(result.content.map((part) => part.type === "tool-call" ? [part.toolName, part.input] : part.type), [
			["echo", '{"value":null}'],
		]);
	}
});

test("SSE normalization handles multiline data, CRLF and single-byte UTF-8 chunks", async () => {
	const value = chunk({ role: null, content: "Grüße", reasoning_content: "Check" }, "stop");
	const body = `: keepalive\r\nid: event-1\r\nevent: message\r\n${JSON.stringify(value, null, 2).split("\n").map((line) => `data: ${line}\r\n`).join("")}\r\ndata: [DONE]\r\n\r\n`;
	const bytes = new TextEncoder().encode(body);
	let offset = 0;
	const response = new Response(new ReadableStream({ pull(controller) {
		if (offset === bytes.length) controller.close();
		else controller.enqueue(bytes.slice(offset, ++offset));
	} }), { headers: { "content-type": "text/event-stream; charset=utf-8", "content-length": String(bytes.length), "content-encoding": "gzip", "x-request-id": "example" } });
	const normalized = await normalizeOpenAiResponse(response);
	assert.equal(normalized.headers.get("content-length"), null);
	assert.equal(normalized.headers.get("content-encoding"), null);
	assert.equal(normalized.headers.get("x-request-id"), "example");
	assert.equal(await normalized.text(), `id: event-1\nevent: message\ndata: ${JSON.stringify(chunk({ content: "Grüße", reasoning_content: "Check" }, "stop"))}\n\ndata: [DONE]\n\n`);
});

for (const delta of [
	{ role: "user" },
	{ role: null, content: 42 },
	{ tool_calls: [{ index: 0, type: "invalid", function: { name: "echo", arguments: "{}" } }] },
	{ tool_calls: [{ index: 0, function: null }] },
	{ tool_calls: [{ index: 0, function: { name: null, arguments: "{}" } }] },
]) {
	test(`malformed delta still fails: ${JSON.stringify(delta)}`, async (t) => {
		t.mock.method(globalThis, "fetch", async () => response([chunk(delta), chunk({}, "stop")]));
		const source = stream(model, context, { apiKey: "test-only" });
		const events = await Array.fromAsync(source);
		const result = await source.result();
		assert.equal(result.stopReason, "error");
		assert.match(result.errorMessage ?? "", /Type validation failed|Expected 'function.name'/);
		assert.deepEqual(events.filter((event) => event.type === "error" || event.type === "done").map((event) => event.type), ["error"]);
	});
}

test("malformed JSON remains an error in SSE and JSON responses", async (t) => {
	t.mock.method(globalThis, "fetch", async () => new Response("data: {broken}\n\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }));
	const result = await stream(model, context, { apiKey: "test-only" }).result();
	assert.equal(result.stopReason, "error");
	assert.match(result.errorMessage ?? "", /JSON/);
	await assert.rejects(normalizeOpenAiResponse(new Response("{broken}", { headers: { "content-type": "application/json" } })), SyntaxError);
	t.mock.method(globalThis, "fetch", async () => new Response("{broken}", { headers: { "content-type": "application/json" } }));
	await assert.rejects(createSdkProvider(model, { apiKey: "test-only" }).chat(model.id).doGenerate({ prompt: [] }), /JSON/);
});

test("normalization retains required fields, application nulls, errors and HTTP metadata", async () => {
	const value = { choices: [{ message: {
		role: null, content: null, refusal: null, audio: null, function_call: null,
		tool_calls: [{ id: "call-1", type: null, function: { name: null, arguments: '{"value":null}' } }],
		extra: { value: null },
	} }] };
	const normalized = await normalizeOpenAiResponse(Response.json(value, { status: 201, statusText: "Created" }));
	assert.equal(normalized.status, 201);
	assert.equal(normalized.statusText, "Created");
	assert.deepEqual(await normalized.json(), { choices: [{ message: {
		role: null, tool_calls: [{ id: "call-1", type: "function", function: { name: null, arguments: '{"value":null}' } }], extra: { value: null },
	} }] });
	for (const response of [Response.json({ error: { message: "Unavailable", details: null } }, { status: 503 }), new Response("plain text")]) {
		assert.equal(await normalizeOpenAiResponse(response), response);
	}
});

test("the real OpenRouter endpoint retains its original validation", async (t) => {
	t.mock.method(globalThis, "fetch", async () => response([chunk({ role: null, content: "Done" }, "stop")]));
	const result = await stream({ ...model, baseUrl: "https://openrouter.ai/api/v1" }, context, { apiKey: "test-only" }).result();
	assert.equal(result.stopReason, "error");
	assert.match(result.errorMessage ?? "", /Type validation failed/);
});
