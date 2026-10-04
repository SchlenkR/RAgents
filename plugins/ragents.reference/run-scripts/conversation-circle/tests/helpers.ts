import { createTestContext } from "@ragents/server/testing";

export const setupContext = (profiles = [{ name: "coordinator", driver: "agent" }, { name: "standard", driver: "agent" }]) => {
  const calls: { name: string; input: unknown }[] = [];
  const functions = Object.fromEntries(["model_list", "agent_spawn", "run_configure", "actor_input", "actor_program_activate"].map((name) => [name, (input: unknown) => {
    calls.push({ name, input });
    if (name === "agent_spawn") {
      const handle = (input as { name: string }).name;
      return { id: `actor-${handle}`, handle };
    }
    if (name === "actor_program_activate") {
      const value = input as { name: string; actor: string };
      return { name: value.name, actor: value.actor, views: 1, active: true };
    }
    return name === "model_list" ? {
      profiles: profiles.map((profile) => ({ ...profile, description: "Test profile", turnTimeoutMs: null,
        isolateWorkspace: false, provider: "test", model: "test" })), models: [],
    } : name === "actor_input" ? [] : null;
  }]));
  return { calls, context: createTestContext<{ built?: boolean }>({ state: {}, functions }) };
};

export const start = (input: unknown, room: string | null = "conversation-circle") => ({
  input, options: {}, embedded: false, startedBy: "owner-id", count: 1, room,
});

export const message = (content: string) => ({
  id: "message", content, artifactIds: [], sourceEventIds: [], subscriptionId: null, event: null,
});
