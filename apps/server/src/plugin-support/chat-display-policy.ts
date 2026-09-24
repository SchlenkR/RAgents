import { CHAT_DETAIL_MODES, CHAT_STEP_SCOPES, type ChatDetailMode, type ChatStepScope } from "./chat-display-contract.js";
import type { DeclaredEnvironment } from "./plugin-config.js";

export { CHAT_DETAIL_MODES, CHAT_STEP_SCOPES };
export type { ChatDetailMode, ChatStepScope };

export interface ChatDisplayPolicy {
  readonly modes: Readonly<Record<ChatStepScope, ChatDetailMode>>;
  readonly stepsVisible: boolean;
  readonly stepsExpandable: boolean;
  readonly selectable: boolean;
}

export const chatDisplayEnvDescriptors = [
  { key: "CHAT_STEPS_MODE_COORDINATOR", source: "environment" },
  { key: "CHAT_STEPS_MODE_AGENTS", source: "environment" },
  { key: "CHAT_STEPS_VISIBLE", source: "environment" },
  { key: "CHAT_STEPS_EXPANDABLE", source: "environment" },
  { key: "CHAT_STEPS_SELECTABLE", source: "environment" },
] as const;

type ChatDisplayKey = (typeof chatDisplayEnvDescriptors)[number]["key"];

type ChatDisplayEnvironment = DeclaredEnvironment<ChatDisplayKey>;

const flag = (env: ChatDisplayEnvironment, key: ChatDisplayKey, fallback: boolean): boolean => {
  const value = env.optional(key);
  if (value === undefined || value === "") return fallback;
  if (value === "1") return true;
  if (value === "0") return false;
  throw new Error(`${key} muss "0" oder "1" sein, nicht "${value}"`);
};

const mode = (env: ChatDisplayEnvironment, key: ChatDisplayKey, fallback: ChatDetailMode): ChatDetailMode => {
  const value = env.optional(key);
  if (value === undefined || value === "") return fallback;
  if (!CHAT_DETAIL_MODES.includes(value as ChatDetailMode)) {
    throw new Error(`${key} muss einer der Werte ${CHAT_DETAIL_MODES.join(", ")} sein, nicht "${value}"`);
  }
  return value as ChatDetailMode;
};

export const chatDisplayPolicyFromEnvironment = (
  env: ChatDisplayEnvironment,
  defaults: { selectable: boolean; stepsExpandable?: boolean },
): ChatDisplayPolicy =>
  Object.freeze({
    modes: Object.freeze({
      coordinator: mode(env, "CHAT_STEPS_MODE_COORDINATOR", "grouped"),
      agents: mode(env, "CHAT_STEPS_MODE_AGENTS", "grouped"),
    }),
    stepsVisible: flag(env, "CHAT_STEPS_VISIBLE", true),
    stepsExpandable: flag(env, "CHAT_STEPS_EXPANDABLE", defaults.stepsExpandable ?? true),
    selectable: flag(env, "CHAT_STEPS_SELECTABLE", defaults.selectable),
  });
