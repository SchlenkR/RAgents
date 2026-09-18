export const SESSIONS_CHANNEL = "sessions";

export const runChannel = (runId: string): string => `run:${runId}`;

export const chatChannel = (runId: string): string => `chat:${runId}`;

export const runIdOfChannel = (channel: string, prefix: string): string | undefined => {
  if (!channel.startsWith(`${prefix}:`)) return undefined;
  const runId = channel.slice(prefix.length + 1);
  return /^[A-Za-z0-9_-]{1,64}$/.test(runId) ? runId : undefined;
};
