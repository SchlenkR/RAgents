import type { JSONValue } from "ai";
import type { AssistantMessage } from "../types.ts";

export function storedReasoningDetails(message: AssistantMessage): JSONValue[] {
	const signatures = message.content.flatMap((part) => {
		const signature = part.type === "thinking" ? part.thinkingSignature : part.type === "toolCall" ? part.thoughtSignature : undefined;
		return signature && /^\s*[\[{]/.test(signature) ? [signature] : [];
	});
	const lists = [...new Set(signatures)].map((signature) => {
		const parsed: JSONValue = JSON.parse(signature);
		const details = Array.isArray(parsed) ? parsed : [parsed];
		if (details.some((detail) => !detail || typeof detail !== "object" || Array.isArray(detail)
			|| typeof detail.type !== "string" || !detail.type.startsWith("reasoning."))) {
			throw new Error("Invalid stored OpenRouter reasoning details.");
		}
		return details;
	});
	const contains = (full: JSONValue[], part: JSONValue[]) => full.some((_, index) =>
		part.every((detail, offset) => JSON.stringify(detail) === JSON.stringify(full[index + offset])));
	return lists.find((list) => lists.every((part) => contains(list, part))) ?? lists.flat();
}

export class ReasoningDetailsAccumulator {
	readonly details: Record<string, unknown>[] = [];
	readonly #indices = new Map<number, Record<string, unknown>>();

	add(details: readonly Record<string, unknown>[]) {
		for (const detail of details) {
			const index = typeof detail.index === "number" ? detail.index : undefined;
			const previous = index === undefined ? undefined : this.#indices.get(index);
			if (previous) {
				for (const [key, value] of Object.entries(detail)) {
					previous[key] = ["text", "summary", "data", "signature"].includes(key) && typeof value === "string"
						? String(previous[key] ?? "") + value : value;
				}
			} else {
				const stored = structuredClone(detail);
				this.details.push(stored);
				if (index !== undefined) this.#indices.set(index, stored);
			}
		}
	}
}
