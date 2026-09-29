/** The few knobs of an agent's runtime; compaction belongs to the model, everything else is fixed. */
export interface AgentSettings {
	/** Retries after a retryable model error, with exponential backoff. */
	retry: { enabled: boolean; maxRetries: number; baseDelayMs: number };
	/** Timeout and retries of a single provider request; unset values leave the SDK defaults. */
	providerRequest: { timeoutMs: number; maxRetries?: number; maxRetryDelayMs: number };
}

export interface AgentSettingsInput {
	retry?: Partial<AgentSettings["retry"]>;
	providerRequest?: Partial<AgentSettings["providerRequest"]>;
}

export const agentSettings = (input: AgentSettingsInput = {}): AgentSettings => ({
	retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000, ...input.retry },
	providerRequest: { timeoutMs: 300_000, maxRetryDelayMs: 60_000, ...input.providerRequest },
});
