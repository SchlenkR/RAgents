/** The few knobs of an agent session; everything else is fixed. */
export interface AgentSettings {
	compaction: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
	/** Retries of the session after a retryable model error, with exponential backoff. */
	retry: { enabled: boolean; maxRetries: number; baseDelayMs: number };
	/** Timeout and retries of a single provider request; unset values leave the SDK defaults. */
	providerRequest: { timeoutMs: number; maxRetries?: number; maxRetryDelayMs: number };
}

export interface AgentSettingsInput {
	compaction?: Partial<AgentSettings["compaction"]>;
	retry?: Partial<AgentSettings["retry"]>;
	providerRequest?: Partial<AgentSettings["providerRequest"]>;
}

export const agentSettings = (input: AgentSettingsInput = {}): AgentSettings => ({
	compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000, ...input.compaction },
	retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000, ...input.retry },
	providerRequest: { timeoutMs: 300_000, maxRetryDelayMs: 60_000, ...input.providerRequest },
});
