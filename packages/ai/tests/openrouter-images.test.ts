import assert from "node:assert/strict";
import test from "node:test";
import { generateImages } from "../src/api/openrouter-images.ts";
import type { ImagesModel } from "../src/types.ts";

const model: ImagesModel<"openrouter-images"> = {
	id: "test/image-model",
	name: "Image test",
	api: "openrouter-images",
	provider: "openrouter",
	baseUrl: "https://images.example/v1",
	input: ["text", "image"],
	output: ["text", "image"],
	cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1.5 },
};

const responseBody = {
	id: "image-response-1",
	model: model.id,
	choices: [{
		index: 0,
		finish_reason: "stop",
		message: {
			role: "assistant",
			content: "Der Entwurf ist fertig.",
			images: [{ type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } }],
		},
	}],
	usage: {
		prompt_tokens: 1000,
		completion_tokens: 200,
		total_tokens: 1200,
		prompt_tokens_details: { cached_tokens: 300, cache_write_tokens: 100 },
	},
};

const context = { input: [{ type: "text" as const, text: "Zeichne einen Kreis." }] };

const response = () => Response.json(responseBody, { headers: { "x-request-id": "request-1" } });

test("images use AI SDK multimodal input and preserve generated text, base64 and costs", async (t) => {
	let payload: Record<string, unknown> | undefined;
	let requestUrl: string | undefined;
	t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
		requestUrl = String(url);
		payload = JSON.parse(String(init.body));
		return response();
	});
	const result = await generateImages(model, { input: [
		{ type: "text", text: "Ändere das Bild.\uD800" },
		{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
	] }, { apiKey: "test-key" });
	assert.equal(result.stopReason, "stop", result.errorMessage);
	assert.equal(requestUrl, "https://images.example/v1/chat/completions");
	assert.equal(payload?.model, model.id);
	assert.equal(payload?.stream, false);
	assert.deepEqual(payload?.modalities, ["image", "text"]);
	assert.deepEqual(payload?.messages, [{ role: "user", content: [
		{ type: "text", text: "Ändere das Bild." },
		{ type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
	] }]);
	assert.equal(result.responseId, "image-response-1");
	assert.deepEqual(result.output, [
		{ type: "text", text: "Der Entwurf ist fertig." },
		{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
	]);
	assert.ok(result.usage);
	const { cost, ...usage } = result.usage;
	assert.deepEqual(usage, {
		input: 600,
		output: 200,
		cacheRead: 300,
		cacheWrite: 100,
		totalTokens: 1200,
	});
	for (const [name, expected] of Object.entries({ input: 0.0006, output: 0.0004, cacheRead: 0.00015, cacheWrite: 0.00015, total: 0.0013 })) {
		assert.ok(Math.abs(cost[name as keyof typeof cost] - expected) < 1e-12, name);
	}
});

test("image payload hooks replace the actual body and null headers suppress defaults", async (t) => {
	let observed: unknown;
	let sent: unknown;
	let headers: Headers | undefined;
	let observedResponse: unknown;
	const configured = { ...model, headers: { "X-Remove": "model", "X-Keep": "keep" } };
	t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
		sent = JSON.parse(String(init.body));
		headers = new Headers(init.headers);
		return response();
	});
	const result = await generateImages(configured, context, {
		apiKey: "test-key",
		headers: { "x-remove": null, authorization: null, "X-Added": "added" },
		onPayload: async (payload, passedModel) => {
			assert.equal(passedModel, configured);
			observed = structuredClone(payload);
			return { ...(payload as object), marker: "replaced" };
		},
		onResponse: async (value, passedModel) => {
			assert.equal(passedModel, configured);
			observedResponse = value;
		},
	});
	assert.equal(result.stopReason, "stop", result.errorMessage);
	assert.deepEqual(sent, { ...(observed as object), marker: "replaced" });
	assert.equal(headers?.has("x-remove"), false);
	assert.equal(headers?.has("authorization"), false);
	assert.equal(headers?.get("x-keep"), "keep");
	assert.equal(headers?.get("x-added"), "added");
	assert.deepEqual(observedResponse, { status: 200, headers: {
		"content-type": "application/json",
		"x-request-id": "request-1",
	} });
});

test("image-only models request only images and absent usage remains absent", async (t) => {
	let payload: Record<string, unknown> | undefined;
	t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
		payload = JSON.parse(String(init.body));
		return Response.json({
			...responseBody,
			usage: undefined,
			choices: [{ ...responseBody.choices[0], message: { ...responseBody.choices[0].message, content: null } }],
		});
	});
	const result = await generateImages({ ...model, output: ["image"] }, context, { apiKey: "test-key" });
	assert.equal(result.stopReason, "stop", result.errorMessage);
	assert.deepEqual(payload?.modalities, ["image"]);
	assert.deepEqual(result.output, [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }]);
	assert.equal(result.usage, undefined);
});

test("image requests do not retry a failed provider response by default", async (t) => {
	const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({
		error: { message: "Provider unavailable", code: 503 },
	}, { status: 503 }));
	const result = await generateImages(model, context, { apiKey: "test-key" });
	assert.equal(result.stopReason, "error");
	assert.match(result.errorMessage ?? "", /Provider unavailable/);
	assert.equal(fetchMock.mock.callCount(), 1);
});

test("image requests honor caller cancellation while fetch is pending", async (t) => {
	const controller = new AbortController();
	const started = Promise.withResolvers<void>();
	t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
		started.resolve();
		return new Promise<Response>((_resolve, reject) => {
			init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
		});
	});
	const pending = generateImages(model, context, { apiKey: "test-key", signal: controller.signal });
	await started.promise;
	controller.abort(new Error("Abgebrochen"));
	const result = await pending;
	assert.equal(result.stopReason, "aborted");
	assert.match(result.errorMessage ?? "", /Abgebrochen/);
});

test("image request timeouts abort the SDK transport", async (t) => {
	t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("missing transport cancellation")), 1_000);
		const onAbort = () => {
			clearTimeout(timer);
			reject(init.signal!.reason);
		};
		if (init.signal!.aborted) onAbort();
		else init.signal!.addEventListener("abort", onAbort, { once: true });
	}));
	const result = await generateImages(model, context, { apiKey: "test-key", timeoutMs: 20 });
	assert.equal(result.stopReason, "error");
	assert.match(result.errorMessage ?? "", /timeout|timed out/i);
});

test("image hook failures and missing credentials become result errors before fetch", async (t) => {
	const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected network"); });
	const missingKey = await generateImages(model, context);
	assert.equal(missingKey.stopReason, "error");
	assert.match(missingKey.errorMessage ?? "", /No API key/);
	const rejectedHook = await generateImages(model, context, {
		apiKey: "test-key",
		onPayload: () => { throw new Error("payload rejected"); },
	});
	assert.equal(rejectedHook.stopReason, "error");
	assert.match(rejectedHook.errorMessage ?? "", /payload rejected/);
	assert.equal(fetchMock.mock.callCount(), 0);
});

for (const [name, images] of [
	["missing images", []],
	["unsupported image shape", [{ image_url: { url: "data:image/png;base64,aW1hZ2U=" } }]],
	["remote URL instead of image bytes", [{ type: "image_url", image_url: { url: "https://images.example/image.png" } }]],
] as const) {
	test(`image generation rejects ${name} instead of returning invalid image content`, async (t) => {
		t.mock.method(globalThis, "fetch", async () => Response.json({
			...responseBody,
			choices: [{ ...responseBody.choices[0], message: { ...responseBody.choices[0].message, images } }],
		}));
		const result = await generateImages(model, context, { apiKey: "test-key" });
		assert.equal(result.stopReason, "error");
		assert.ok(result.errorMessage);
		assert.deepEqual(result.output, []);
	});
}
