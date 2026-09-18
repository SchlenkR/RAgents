import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { fauxAssistantMessage, fauxThinking, fauxToolCall, registerFauxProvider, type FauxResponseStep, type Message } from "@aicontainer/ai";
import { EMPTY_RESPONSE_FAILURE, EMPTY_RESPONSE_NUDGE, runAgentLoop } from "../src/agent-loop.ts";
import type { AgentContext, AgentEvent, AgentMessage, AgentTool } from "../src/types.ts";

const reasoningOnly = () => fauxAssistantMessage([fauxThinking("Ich überlege noch.")]);
const ping: AgentTool = {
	name: "ping", label: "Ping", description: "Antwortet mit pong.", parameters: Type.Object({}),
	execute: async () => ({ content: [{ type: "text", text: "pong" }], details: {} }),
};
const isNudge = (message: AgentMessage) => message.role === "user" && message.content === EMPTY_RESPONSE_NUDGE;

const run = async (responses: FauxResponseStep[]) => {
	const faux = registerFauxProvider({ models: [{ id: "empty-response", reasoning: true }], tokensPerSecond: 100000 });
	try {
		faux.setResponses(responses);
		const events: AgentEvent[] = [];
		const context: AgentContext = { systemPrompt: "Test", messages: [], tools: [ping] };
		const messages = await runAgentLoop(
			[{ role: "user", content: "Los", timestamp: Date.now() }],
			context,
			{ model: faux.getModel(), apiKey: "faux-key", convertToLlm: (entries) => entries as Message[] },
			(event) => { events.push(event); },
		);
		return { events, messages };
	} finally {
		faux.unregister();
	}
};

test("a reasoning-only response is nudged once and the loop continues with the next answer", async () => {
	const seen: string[] = [];
	const { messages } = await run([
		reasoningOnly,
		(request) => {
			const last = request.messages.at(-1);
			seen.push(last?.role === "user" && typeof last.content === "string" ? last.content : "");
			return fauxAssistantMessage("Fertig.");
		},
	]);
	assert.deepEqual(seen, [EMPTY_RESPONSE_NUDGE]);
	assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "user", "assistant"]);
	const last = messages.at(-1);
	assert.ok(last?.role === "assistant");
	assert.equal(last.stopReason, "stop");
	assert.deepEqual(last.content, [{ type: "text", text: "Fertig." }]);
});

test("two reasoning-only responses in a row end the loop as a failure with the cause", async () => {
	let calls = 0;
	const { events, messages } = await run([
		() => { calls++; return reasoningOnly(); },
		() => { calls++; return reasoningOnly(); },
		() => { calls++; return fauxAssistantMessage("Unerreichbar."); },
	]);
	assert.equal(calls, 2);
	assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "user", "assistant"]);
	const last = messages.at(-1);
	assert.ok(last?.role === "assistant");
	assert.equal(last.stopReason, "error");
	assert.equal(last.errorMessage, EMPTY_RESPONSE_FAILURE);
	const ended = events.filter((event) => event.type === "message_end" && event.message.role === "assistant").at(-1);
	assert.ok(ended?.type === "message_end" && ended.message.role === "assistant");
	assert.equal(ended.message.stopReason, "error");
	assert.equal(events.at(-1)?.type, "agent_end");
});

test("a tool call after the nudge resets the streak, so a later empty response is nudged instead of failing", async () => {
	const { messages } = await run([
		reasoningOnly,
		() => fauxAssistantMessage([fauxToolCall("ping", {})]),
		reasoningOnly,
		() => fauxAssistantMessage("Fertig."),
	]);
	assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "user", "assistant", "toolResult", "assistant", "user", "assistant"]);
	assert.equal(messages.filter(isNudge).length, 2);
	const last = messages.at(-1);
	assert.ok(last?.role === "assistant");
	assert.equal(last.stopReason, "stop");
});
