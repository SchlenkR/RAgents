/** Context compaction over the context log of one agent; pure functions, the caller persists the result. */

import type { AgentMessage, StreamFn, ThinkingLevel } from "../../loop/index.ts";
import type { AssistantMessage, Context, Model, ModelCompaction, SimpleStreamOptions, Usage } from "@ragents/ai";
import { completeSimple } from "@ragents/ai";
import { type ContextCompaction, type ContextLogEntry, contextEntryMessages, contextMessages } from "../context-log.ts";
import { convertToLlm } from "../messages.ts";
import {
	computeFileLists,
	createFileOps,
	extractFileOpsFromMessage,
	type FileOperations,
	formatFileOperations,
	SUMMARIZATION_SYSTEM_PROMPT,
	serializeConversation,
	collectUserAttachments,
} from "./utils.ts";

/** Earlier compaction lists plus the file operations of the summarized messages. */
function extractFileOperations(messages: AgentMessage[], previous: ContextCompaction | undefined): FileOperations {
	const fileOps = createFileOps();
	for (const file of previous?.readFiles ?? []) fileOps.read.add(file);
	for (const file of previous?.modifiedFiles ?? []) fileOps.edited.add(file);
	for (const msg of messages) {
		extractFileOpsFromMessage(msg, fileOps);
	}
	return fileOps;
}

function messageOf(entry: ContextLogEntry): AgentMessage | undefined {
	return entry.kind === "message" ? entry.message : undefined;
}

/** Result of compact(); the caller records it as a compaction entry. */
export interface CompactionResult {
	summary: string;
	firstKeptId: string;
	tokensBefore: number;
	estimatedTokensAfter?: number;
	readFiles: string[];
	modifiedFiles: string[];
}

// ============================================================================
// Compaction values of a model
// ============================================================================

const CATALOG_RESERVE_TOKENS = 16384;

/** The catalog standard of a model without own values: compact 16384 tokens below its context window. */
export function catalogCompaction(model: Pick<Model<any>, "contextWindow">): ModelCompaction {
	return {
		threshold: model.contextWindow - CATALOG_RESERVE_TOKENS,
		keepRecentTokens: 20000,
		summaryTokens: Math.floor(0.8 * CATALOG_RESERVE_TOKENS),
	};
}

/** Where the compaction values of a model come from. */
export type CompactionSource = "model" | "catalog";

/** The compaction values an agent applies on a model: its own, else the catalog standard. */
export function compactionOf(model: Model<any>): { values: ModelCompaction; source: CompactionSource } {
	return model.compaction
		? { values: model.compaction, source: "model" }
		: { values: catalogCompaction(model), source: "catalog" };
}

const COMPACTION_KEYS: readonly string[] = ["threshold", "keepRecentTokens", "summaryTokens"];

/** Why a value is no valid set of compaction values, or undefined; with a model also whether they fit its context window and output limit. */
export function compactionProblem(
	value: unknown,
	model?: Pick<Model<any>, "contextWindow" | "maxTokens">,
): string | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return "compaction needs threshold, keepRecentTokens and summaryTokens";
	}
	const fields = value as Record<string, unknown>;
	const unknown = Object.keys(fields).find((key) => !COMPACTION_KEYS.includes(key));
	if (unknown) return `compaction.${unknown} is not supported`;
	const invalid = COMPACTION_KEYS.find((key) => !Number.isSafeInteger(fields[key]) || (fields[key] as number) < 1);
	if (invalid) return `compaction.${invalid} must be a positive integer`;
	const { threshold, keepRecentTokens, summaryTokens } = value as ModelCompaction;
	if (keepRecentTokens + summaryTokens >= threshold) {
		return `compaction: keepRecentTokens plus summaryTokens (${keepRecentTokens + summaryTokens}) must stay below threshold (${threshold})`;
	}
	if (!model) return undefined;
	if (threshold + summaryTokens >= model.contextWindow) {
		return `compaction: threshold plus summaryTokens (${threshold + summaryTokens}) must stay below the context window (${model.contextWindow})`;
	}
	if (model.maxTokens > 0 && summaryTokens > model.maxTokens) {
		return `compaction.summaryTokens (${summaryTokens}) exceeds the output limit (${model.maxTokens})`;
	}
	return undefined;
}

/** The summary of a split turn's beginning gets five eighths of the summary budget, the ratio the forked runtime used. */
const turnPrefixTokens = (summaryTokens: number): number => Math.round((summaryTokens * 5) / 8);

// ============================================================================
// Token calculation
// ============================================================================

/**
 * Calculate total context tokens from usage.
 * Uses the native totalTokens field when available, falls back to computing from components.
 */
export function calculateContextTokens(usage: Usage): number {
	return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

/**
 * Get usage from an assistant message if available.
 * Skips aborted, error, and all-zero usage messages as they don't have valid usage data.
 */
function getAssistantUsage(msg: AgentMessage): Usage | undefined {
	if (msg.role === "assistant" && "usage" in msg) {
		const assistantMsg = msg as AssistantMessage;
		if (
			assistantMsg.stopReason !== "aborted" &&
			assistantMsg.stopReason !== "error" &&
			assistantMsg.usage &&
			calculateContextTokens(assistantMsg.usage) > 0
		) {
			return assistantMsg.usage;
		}
	}
	return undefined;
}

export interface ContextUsageEstimate {
	tokens: number;
	usageTokens: number;
	trailingTokens: number;
	lastUsageIndex: number | null;
}

function getLastAssistantUsageInfo(messages: AgentMessage[], startIndex: number): { usage: Usage; index: number } | undefined {
	for (let i = messages.length - 1; i >= startIndex; i--) {
		const usage = getAssistantUsage(messages[i]);
		if (usage) return { usage, index: i };
	}
	return undefined;
}

/**
 * Estimate context tokens from messages, using the last assistant usage when available.
 * If there are messages after the last usage, estimate their tokens with estimateTokens.
 */
export function estimateContextTokens(messages: AgentMessage[], usageStartIndex = 0): ContextUsageEstimate {
	const usageInfo = getLastAssistantUsageInfo(messages, usageStartIndex);

	if (!usageInfo) {
		let estimated = 0;
		for (const message of messages) {
			estimated += estimateTokens(message);
		}
		return {
			tokens: estimated,
			usageTokens: 0,
			trailingTokens: estimated,
			lastUsageIndex: null,
		};
	}

	const usageTokens = calculateContextTokens(usageInfo.usage);
	let trailingTokens = 0;
	for (let i = usageInfo.index + 1; i < messages.length; i++) {
		trailingTokens += estimateTokens(messages[i]);
	}

	return {
		tokens: usageTokens + trailingTokens,
		usageTokens,
		trailingTokens,
		lastUsageIndex: usageInfo.index,
	};
}

/** Whether a context of this size lies above the compaction threshold. */
export function shouldCompact(contextTokens: number, compaction: ModelCompaction): boolean {
	return contextTokens > compaction.threshold;
}

// ============================================================================
// Cut point detection
// ============================================================================

const ESTIMATED_IMAGE_CHARS = 4800;

function estimateTextAndImageContentChars(content: string | Array<{ type: string; text?: string; data?: string }>): number {
	if (typeof content === "string") {
		return content.length;
	}

	let chars = 0;
	for (const block of content) {
		if (block.type === "text" && block.text) {
			chars += block.text.length;
		} else if (block.type === "image") {
			chars += ESTIMATED_IMAGE_CHARS;
		} else if (block.type === "video" || block.type === "file") {
			chars += Math.max(ESTIMATED_IMAGE_CHARS, block.data?.length ?? 0);
		}
	}
	return chars;
}

/**
 * Estimate token count for a message using chars/4 heuristic.
 * This is conservative (overestimates tokens).
 */
export function estimateTokens(message: AgentMessage): number {
	let chars = 0;

	switch (message.role) {
		case "user": {
			chars = estimateTextAndImageContentChars(
				(message as { content: string | Array<{ type: string; text?: string; data?: string }> }).content,
			);
			return Math.ceil(chars / 4);
		}
		case "assistant": {
			const assistant = message as AssistantMessage;
			for (const block of assistant.content) {
				if (block.type === "text") {
					chars += block.text.length;
				} else if (block.type === "thinking") {
					chars += block.thinking.length;
				} else if (block.type === "toolCall") {
					chars += block.name.length + JSON.stringify(block.arguments).length;
				}
			}
			return Math.ceil(chars / 4);
		}
		case "custom":
		case "toolResult": {
			chars = estimateTextAndImageContentChars(message.content);
			return Math.ceil(chars / 4);
		}
		case "compactionSummary": {
			chars = message.summary.length;
			return Math.ceil(chars / 4);
		}
	}

	return 0;
}

function isCutPointMessage(message: AgentMessage): boolean {
	switch (message.role) {
		case "user":
		case "assistant":
		case "custom":
		case "compactionSummary":
			return true;
		case "toolResult":
			return false;
	}
	return false;
}

function isTurnStartMessage(message: AgentMessage): boolean {
	switch (message.role) {
		case "user":
		case "custom":
		case "compactionSummary":
			return true;
		case "assistant":
		case "toolResult":
			return false;
	}
	return false;
}

function isTurnStartEntry(entry: ContextLogEntry): boolean {
	return entry.kind === "message" && isTurnStartMessage(entry.message);
}

/** User-like or assistant messages, never a tool result, since it must follow its call. */
function findValidCutPoints(entries: ContextLogEntry[], startIndex: number, endIndex: number): number[] {
	const cutPoints: number[] = [];
	for (let i = startIndex; i < endIndex; i++) {
		const entry = entries[i];
		if (entry.kind === "message" && isCutPointMessage(entry.message)) {
			cutPoints.push(i);
		}
	}
	return cutPoints;
}

/** The user-like message that starts the turn containing the given index, or -1. */
export function findTurnStartIndex(entries: ContextLogEntry[], entryIndex: number, startIndex: number): number {
	for (let i = entryIndex; i >= startIndex; i--) {
		if (isTurnStartEntry(entries[i])) {
			return i;
		}
	}
	return -1;
}

export interface CutPointResult {
	/** Index of first entry to keep */
	firstKeptEntryIndex: number;
	/** Index of user message that starts the turn being split, or -1 if not splitting */
	turnStartIndex: number;
	/** Whether this cut splits a turn (cut point is not a user message) */
	isSplitTurn: boolean;
}

/** The valid cut point that keeps about `keepRecentTokens` of the entries between `startIndex` and `endIndex`, counted from the newest. */
export function findCutPoint(
	entries: ContextLogEntry[],
	startIndex: number,
	endIndex: number,
	keepRecentTokens: number,
): CutPointResult {
	const cutPoints = findValidCutPoints(entries, startIndex, endIndex);

	if (cutPoints.length === 0) {
		return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
	}

	let accumulatedTokens = 0;
	let cutIndex = cutPoints[0];

	for (let i = endIndex - 1; i >= startIndex; i--) {
		const messageTokens = contextEntryMessages(entries[i]).reduce((sum, message) => sum + estimateTokens(message), 0);
		if (messageTokens === 0) continue;
		accumulatedTokens += messageTokens;

		if (accumulatedTokens >= keepRecentTokens) {
			cutIndex = cutPoints[cutPoints.length - 1];
			for (let c = 0; c < cutPoints.length; c++) {
				if (cutPoints[c] >= i) {
					cutIndex = cutPoints[c];
					break;
				}
			}
			break;
		}
	}

	const cutEntry = entries[cutIndex];
	const startsTurn = isTurnStartEntry(cutEntry);
	const turnStartIndex = startsTurn ? -1 : findTurnStartIndex(entries, cutIndex, startIndex);

	return {
		firstKeptEntryIndex: cutIndex,
		turnStartIndex,
		isSplitTurn: !startsTurn && turnStartIndex !== -1,
	};
}

// ============================================================================
// Summarization
// ============================================================================

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

function createSummarizationOptions(
	model: Model<any>,
	maxTokens: number,
	apiKey: string | undefined,
	headers: Record<string, string> | undefined,
	env: Record<string, string> | undefined,
	signal: AbortSignal | undefined,
	thinkingLevel: ThinkingLevel | undefined,
): SimpleStreamOptions {
	const options: SimpleStreamOptions = { maxTokens, signal, apiKey, headers, env };
	if (model.reasoning && thinkingLevel && thinkingLevel !== "off") {
		options.reasoning = thinkingLevel;
	}
	return options;
}

async function completeSummarization(
	model: Model<any>,
	context: Context,
	options: SimpleStreamOptions,
	streamFn?: StreamFn,
): Promise<AssistantMessage> {
	if (!streamFn) {
		return completeSimple(model, context, options);
	}
	const stream = await streamFn(model, context, options);
	return stream.result();
}

/**
 * Generate a summary of the conversation using the LLM.
 * If previousSummary is provided, uses the update prompt to merge.
 */
export async function generateSummary(
	currentMessages: AgentMessage[],
	model: Model<any>,
	summaryTokens: number,
	apiKey: string | undefined,
	headers?: Record<string, string>,
	signal?: AbortSignal,
	customInstructions?: string,
	previousSummary?: string,
	thinkingLevel?: ThinkingLevel,
	streamFn?: StreamFn,
	env?: Record<string, string>,
): Promise<string> {
	const maxTokens = Math.min(summaryTokens, model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY);

	// Use update prompt if we have a previous summary, otherwise initial prompt
	let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
	if (customInstructions) {
		basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
	}

	// Serialize conversation to text so model doesn't try to continue it
	// Convert to LLM messages first (handles custom types like custom and compaction summaries)
	const llmMessages = convertToLlm(currentMessages);
	const conversationText = serializeConversation(llmMessages);

	// Build the prompt with conversation wrapped in tags
	let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
	if (previousSummary) {
		promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
	}
	promptText += basePrompt;

	const summarizationMessages = [
		{
			role: "user" as const,
			content: [{ type: "text" as const, text: promptText }, ...collectUserAttachments(llmMessages)],
			timestamp: Date.now(),
		},
	];

	const completionOptions = createSummarizationOptions(model, maxTokens, apiKey, headers, env, signal, thinkingLevel);

	const response = await completeSummarization(
		model,
		{ systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
		completionOptions,
		streamFn,
	);

	if (response.stopReason === "error") {
		throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);
	}

	const textContent = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	return textContent;
}

// ============================================================================
// Compaction Preparation
// ============================================================================

export interface CompactionPreparation {
	/** Id of the first entry to keep */
	firstKeptId: string;
	/** Messages that will be summarized and discarded */
	messagesToSummarize: AgentMessage[];
	/** Messages that will be turned into turn prefix summary (if splitting) */
	turnPrefixMessages: AgentMessage[];
	/** Whether this is a split turn (cut point in middle of turn) */
	isSplitTurn: boolean;
	tokensBefore: number;
	/** Summary from previous compaction, for iterative update */
	previousSummary?: string;
	/** File operations extracted from messagesToSummarize */
	fileOps: FileOperations;
	compaction: ModelCompaction;
}

/** Prepares a compaction of the whole context log; undefined when there is nothing to summarize. */
export function prepareCompaction(
	entries: ContextLogEntry[],
	compaction: ModelCompaction,
): CompactionPreparation | undefined {
	if (entries.length > 0 && entries[entries.length - 1].kind === "compaction") {
		return undefined;
	}

	let prevCompactionIndex = -1;
	for (let i = entries.length - 1; i >= 0; i--) {
		if (entries[i].kind === "compaction") {
			prevCompactionIndex = i;
			break;
		}
	}

	const previous = prevCompactionIndex >= 0 ? (entries[prevCompactionIndex] as ContextCompaction) : undefined;
	let boundaryStart = 0;
	if (previous) {
		const firstKeptEntryIndex = entries.findIndex((entry) => entry.id === previous.firstKeptId);
		boundaryStart = firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : prevCompactionIndex + 1;
	}
	const boundaryEnd = entries.length;

	const messages = contextMessages(entries);
	const usageStartIndex = previous ? messages.length - (entries.length - prevCompactionIndex - 1) : 0;
	const tokensBefore = estimateContextTokens(messages, usageStartIndex).tokens;

	const cutPoint = findCutPoint(entries, boundaryStart, boundaryEnd, compaction.keepRecentTokens);
	const firstKeptEntry = entries[cutPoint.firstKeptEntryIndex];
	if (!firstKeptEntry) {
		return undefined;
	}

	const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;

	const messagesToSummarize: AgentMessage[] = [];
	for (let i = boundaryStart; i < historyEnd; i++) {
		const msg = messageOf(entries[i]);
		if (msg) messagesToSummarize.push(msg);
	}

	const turnPrefixMessages: AgentMessage[] = [];
	if (cutPoint.isSplitTurn) {
		for (let i = cutPoint.turnStartIndex; i < cutPoint.firstKeptEntryIndex; i++) {
			const msg = messageOf(entries[i]);
			if (msg) turnPrefixMessages.push(msg);
		}
	}

	if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) {
		return undefined;
	}

	const fileOps = extractFileOperations(messagesToSummarize, previous);
	if (cutPoint.isSplitTurn) {
		for (const msg of turnPrefixMessages) {
			extractFileOpsFromMessage(msg, fileOps);
		}
	}

	return {
		firstKeptId: firstKeptEntry.id,
		messagesToSummarize,
		turnPrefixMessages,
		isSplitTurn: cutPoint.isSplitTurn,
		tokensBefore,
		previousSummary: previous?.summary,
		fileOps,
		compaction,
	};
}

// ============================================================================
// Main compaction function
// ============================================================================

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`;

/** Summarizes a prepared compaction; the caller records the result. */
export async function compact(
	preparation: CompactionPreparation,
	model: Model<any>,
	apiKey: string | undefined,
	headers?: Record<string, string>,
	customInstructions?: string,
	signal?: AbortSignal,
	thinkingLevel?: ThinkingLevel,
	streamFn?: StreamFn,
	env?: Record<string, string>,
): Promise<CompactionResult> {
	const {
		firstKeptId,
		messagesToSummarize,
		turnPrefixMessages,
		isSplitTurn,
		tokensBefore,
		previousSummary,
		fileOps,
		compaction,
	} = preparation;

	// Generate summaries and merge into one
	let summary: string;

	if (isSplitTurn && turnPrefixMessages.length > 0) {
		const historyResult =
			messagesToSummarize.length > 0
				? await generateSummary(
						messagesToSummarize,
						model,
						compaction.summaryTokens,
						apiKey,
						headers,
						signal,
						customInstructions,
						previousSummary,
						thinkingLevel,
						streamFn,
						env,
					)
				: "No prior history.";
		const turnPrefixResult = await generateTurnPrefixSummary(
			turnPrefixMessages,
			model,
			turnPrefixTokens(compaction.summaryTokens),
			apiKey,
			headers,
			env,
			signal,
			thinkingLevel,
			streamFn,
		);
		// Merge into single summary
		summary = `${historyResult}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult}`;
	} else {
		// Just generate history summary
		summary = await generateSummary(
			messagesToSummarize,
			model,
			compaction.summaryTokens,
			apiKey,
			headers,
			signal,
			customInstructions,
			previousSummary,
			thinkingLevel,
			streamFn,
			env,
		);
	}

	const { readFiles, modifiedFiles } = computeFileLists(fileOps);
	summary += formatFileOperations(readFiles, modifiedFiles);

	return { summary, firstKeptId, tokensBefore, readFiles, modifiedFiles };
}

/**
 * Generate a summary for a turn prefix (when splitting a turn).
 */
async function generateTurnPrefixSummary(
	messages: AgentMessage[],
	model: Model<any>,
	budgetTokens: number,
	apiKey: string | undefined,
	headers?: Record<string, string>,
	env?: Record<string, string>,
	signal?: AbortSignal,
	thinkingLevel?: ThinkingLevel,
	streamFn?: StreamFn,
): Promise<string> {
	const maxTokens = Math.min(budgetTokens, model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY);
	const llmMessages = convertToLlm(messages);
	const conversationText = serializeConversation(llmMessages);
	const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`;
	const summarizationMessages = [
		{
			role: "user" as const,
			content: [{ type: "text" as const, text: promptText }, ...collectUserAttachments(llmMessages)],
			timestamp: Date.now(),
		},
	];

	const response = await completeSummarization(
		model,
		{ systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
		createSummarizationOptions(model, maxTokens, apiKey, headers, env, signal, thinkingLevel),
		streamFn,
	);

	if (response.stopReason === "error") {
		throw new Error(`Turn prefix summarization failed: ${response.errorMessage || "Unknown error"}`);
	}

	return response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}
