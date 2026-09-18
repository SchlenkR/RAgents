export const CHAT_DETAIL_MODES = ["off", "current", "icons", "chips", "grouped", "compact", "full"] as const;

export type ChatDetailMode = (typeof CHAT_DETAIL_MODES)[number];

export const CHAT_STEP_SCOPES = ["coordinator", "agents"] as const;

export type ChatStepScope = (typeof CHAT_STEP_SCOPES)[number];
