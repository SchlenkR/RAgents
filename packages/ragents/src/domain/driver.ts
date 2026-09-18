export const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof thinkingLevels)[number];

export const isThinkingLevel = (value: unknown): value is ThinkingLevel =>
    typeof value === "string" && (thinkingLevels as readonly string[]).includes(value);

export type ModelSelection = {
    provider: string;
    model: string;
    thinking?: ThinkingLevel;
};

export type AgentDriverConfigs = {
    manual: Record<string, never>;
    script: Record<string, never>;
    agent: ModelSelection;
};

export type AgentDriverKind = keyof AgentDriverConfigs;

const driverKinds: Record<AgentDriverKind, true> = {
    manual: true,
    script: true,
    agent: true,
};

export const agentDriverKinds = Object.keys(driverKinds) as AgentDriverKind[];

export const isAgentDriverKind = (value: unknown): value is AgentDriverKind =>
    typeof value === "string" && Object.hasOwn(driverKinds, value);

export type AgentDriverRef = {
    [Kind in AgentDriverKind]: { kind: Kind; config: AgentDriverConfigs[Kind] };
}[AgentDriverKind];

export type AgentExecution = {
    driver: AgentDriverRef;
    workspacePath: string | null;
    turnTimeoutMs: number | null;
};

export const manualExecution = (): AgentExecution => ({
    driver: { kind: "manual", config: {} },
    workspacePath: null,
    turnTimeoutMs: null,
});

export const scriptExecution = (turnTimeoutMs: number | null = null): AgentExecution => ({
    driver: { kind: "script", config: {} },
    workspacePath: null,
    turnTimeoutMs,
});

export const modelSelectionOf = (execution: AgentExecution): ModelSelection | null =>
    execution.driver.kind === "manual" || execution.driver.kind === "script" ? null : execution.driver.config;
